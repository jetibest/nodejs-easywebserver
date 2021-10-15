const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cookie = require('cookie'); // npm install cookie

// this creates sessions, but never removes it..
// stale sessions can be pruned with a cronscript, depending on the last modification time of a session
// for example: find path/to/sessions/ -mtime +90 -delete, deletes sessions that haven't been active in 90 days

function sanitize(key)
{
	return key ? (key + '').replace(/[^a-z0-9_-]+/gi, '') : '';
}

module.exports = function(options)
{
	var sessionStoragePath = options.storagePath || './sessions'; // local storage path, where to put the sessions on the server
	var sessionName = options.name || 'session_id';
	var sessionTimeoutMS = options.timeoutMS || (Date.now() + 100 * 365 * 3600 * 1000); // defaults to one century from now, logging out should be done using request.session.removeItem('login') or something
	var sessionMatch = options.match || null; // only create session when matching a given url path
	var sessionSecure = 'secure' in options ? !!options.secure : true; // only over HTTPS, not plain HTTP, enabled by default (for security reasons)
	var sessionHttpOnly = 'httpOnly' in options ? !!options.httpOnly : true; // only serverside may access (not javascript on clientside), enabled by default (for security reasons)
	
	this.group = 'pre-route',
	this.middleware = async function(req, res, next)
	{
		// session already exists (maybe some other middleware)
		if(req.session) return next();
		
		// if match is given, but url path (excluding querystring) doesn't match, then don't do sessions here
		if(sessionMatch && !sessionMatch.test(req.url.replace(/[?]+.*$/g, ''))) return next();
		
		// generate new session using crypto randomBytes async etc.
		// use a specially designated session storage directory, or by default, in current working directory/sessions
		// and then directory name is unique random string (check for collisions)
		// and then key-value store with key filename and value is contents of file
		
		// usage in JSML would be: request.session.start(), request.session.destroy() -> completely destroy the cookie, so it is invalid... what's the use?, and request.session.getItem(key[, defaultValue]), and request.session.setItem(key, value), and removeItem(key), and request.session.clear() to clear the session values, but to keep the session...
		// session destroy better not to implement
		// if a key does not exist, that the user provides, just ignore, and set-cookie new one
		
		// we can just do the cookie parsing and serializing ourselves, and get rid of the cookie-dependency
		
		if(!req.cookies) req.cookies = cookie.parse(req.headers['cookie'] || '') || [];
		
		var session_id = req.cookies[sessionName];
		var session_stat = null; // if not falsy, then the given session id must really exist
		var session_dir = null;
		
		if(session_id)
		{
			// try to find in filesystem our session file:
			// date is creation date, last modified says when it was last changed, last accessed means when was last time we used it
			// > cat /path/to/sessions/2021-09-05--21-46-58-123--RANDOM_BYTES_HEX.txt
			// key1 = uri_component_encoded_value1
			// key2 = ...
			
			session_dir = path.join(sessionStoragePath, 'session.' + session_id);
			
			var stat = await fs.promises.stat(session_dir).catch(function(){});
			
			if(stat)
			{
				session_stat = stat;
			}
		}
		
		// what if we receive a cookie in req.cookies, but the file doesn't exist?
		
		if(!session_stat && !res.headersSent) // cannot create session if headers sent already, this might be due to some url redirection from another module etc.
		{
			// same number as MAC-addr, the time is included to guarantee uniqueness
			var random_bytes = await new Promise((resolve, reject) => crypto.randomBytes(6, function(err, buf)
			{
				if(err)
				{
					reject(err);
				}
				else
				{
					resolve(buf);
				}
			})).catch(function(err){throw err});
			var creation_date = new Date();
			
			session_id = creation_date.toJSON().replace(/[:.]/g, '-') + '--' + random_bytes.toString('hex');
			session_dir = path.join(sessionStoragePath, 'session.' + session_id);
			
			// create new directory for session
			await fs.promises.mkdir(session_dir, {recursive: true}).catch(function(err){ throw err; });
			
			// set set-cookie header, which tells client to send back the header: Cookie: sessionName=session_id, so that we may identify it as the same user
			res.setHeader('Set-Cookie', cookie.serialize(sessionName, session_id, {
				httpOnly: true,
				secure: true,
				expires: new Date(creation_date.getTime() + sessionTimeoutMS)
			}));
			
			session_stat = await fs.promises.stat(session_dir).catch(function(err){ throw err; });
		}
		
		// if we want to avoid flock, which nodejs doesn't play nice with, we should use directories as sessions, and write each key/value as a separate file
		// then it's pretty much atomic, especially for <4K writes/reads
		
		// warning, session key MUST be properly sanitized! may only be alphanumeric? or we must encode special chars, like percent encoding, but filesystem-safe
		// prevent going out of scope with ../ etc
		
		// similar API as the localStorage and sessionStorage, except this is async, so please use await for consistency in code flow
		req.session = {
			id: session_id,
			stat: session_stat, // if stat is falsy, then it was only just created
			// returns data on success, null on failure (i.e. if item does not exist)
			getItem: async function(key, readFile_options)
			{
				// only access file on demand (this ensures our activity measurement is correct)
				var sanitized_key = sanitize(key);
				if(!sanitized_key) return false;
				
				return await fs.promises.readFile(path.join(session_dir, sanitized_key)).catch(function(){return null;});
			},
			// returns true on success, false on failure
			setItem: async function(key, value, writeFile_options)
			{
				// write to file with new key, so we read line by line, and update when we pass the line with the correct key
				var sanitized_key = sanitize(key);
				if(!sanitized_key) return false;
				
				return await fs.promises.writeFile(path.join(session_dir, sanitized_key), value, writeFile_options).then(function(){return true;}).catch(function(){return false;});
			},
			// returns true on success, false on failure
			removeItem: async function(key)
			{
				// delete file
				var sanitized_key = sanitize(key);
				if(!sanitized_key) return false;
				
				return await fs.promises.unlink(path.join(session_dir, sanitized_key)).then(function(){return true;}).catch(function(){return false;});
			},
			// no return value
			clear: async function()
			{
				var files = await fs.readdir(directory).catch(function(err){ throw err; });
				
				if(!files || !files.length) return;
				
				const promises = files.map(file => fs.unlink(path.join(directory, file)));
				
				return await Promise.all(promises);
			}
		};
		
		next();
	};
	
	var sessionStoragePath = options.storagePath || './sessions'; // local storage path, where to put the sessions on the server
	var sessionName = options.name || 'session_id';
	var sessionTimeoutMS = options.timeoutMS || (Date.now() + 100 * 365 * 3600 * 1000); // defaults to one century from now, logging out should be done using request.session.removeItem('login') or something
	var sessionMatch = options.match || null; // only create session when matching a given url path
	var sessionSecure = 'secure' in options ? !!options.secure : true; // only over HTTPS, not plain HTTP, enabled by default (for security reasons)
	var sessionHttpOnly = 'httpOnly' in options ? !!options.httpOnly : true; // only serverside may access (not javascript on clientside), enabled by default (for security reasons)
	
	console.log('mod-session initialized, creates cookie, and provides request.session object with API similar to LocalStorage. Session storagePath=' + sessionStoragePath + ', name=' + sessionName + ', timeoutMS=' + sessionTimeoutMS + ', match=' + sessionMatch + ', secure=' + sessionSecure + ', httpOnly=' + sessionHttpOnly);
};
