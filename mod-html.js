const path = require('path');
const fs = require('fs');
const send = require('send');

module.exports = function(options)
{
	const mod = this;
	const webdir = path.resolve(this.__dirname || __dirname, options.webdir || this.webdir || 'public_html');
	const followSymlinks = options.followSymlinks; // true, false, or 'unsafe' (which also breaks webdir jail)
	
	this.mountPath = options.path || '/';
	this.middleware = async function(req, res, next)
	{
		if(res.headersSent || res.statusCode !== 200) return next();
		
		if(req.method !== 'GET' && req.method !== 'HEAD') return next();
		
		var url_path = req.url.replace(/[?#].*$/g, '');
		var target_dir = path.normalize(url_path);
		
		if(url_path.endsWith('/'))
		{
			try
			{
				var target_stat = await fs.promises.stat(path.join(webdir, target_dir));
				
				if(target_stat.isDirectory())
				{
					// try to find index.html if directory
					target_dir = target_dir.replace(/[/]/g, '') + '/index.html';
				}
			}
			catch(err)
			{
				if(err.code === 'ENOENT')
				{
					// in absence of directory, try to match name with .html
					target_dir = target_dir.replace(/[/]$/g, '') + '.html';
				}
				else
				{
					return next();
				}
			}
		}

		var jail_path = webdir;
		if(followSymlinks !== 'unsafe')
		{
			try
			{
				target_dir = path.resolve(path.join(webdir, target_dir));
				
				var real_target_dir = await fs.promises.realpath(target_dir);
				var real_webdir = await fs.promises.realpath(webdir);

				// if nofollow, but target points somewhere else, then skip, but only from webdir, because webdir itself is allowed to be a symlink
				if(!followSymlinks && path.relative(real_webdir, real_target_dir) !== path.relative(webdir, target_dir)) return next();
				
				// check jailbreak for the real target path (but only if followSymlinks is set to unsafe)
				if(!real_target_dir.startsWith(real_webdir)) return next();

				target_dir = '/' + path.relative(real_webdir, real_target_dir);
				jail_path = real_webdir;
			}
			catch(err)
			{
				console.error(err);
				if(err.code !== 'ENOENT')
				{
					console.error('mod-html:', err);
				}
				return next(); // maybe it doesn't exist
			}
		}

		var nextwrap = function()
		{
			if(!next) return;
			next();
			next = null;
		};

		var s = send(req, target_dir, {root: jail_path});
		s.on('directory', function()
		{
			// careful: by default send does a 301 Moved Permanently redirect when a directory is passed!
			nextwrap();
		});
		s.on('error', function(err)
		{
			if(err.code === 'ENOENT')
			{
				// file does not exist, but don't set 404, because another mod might still catch this somehow
				return nextwrap();
			}
			res.statusCode = err.status || 500;
			nextwrap(); // if error, end is not called (wrap next-call to ensure)
		});
		s.on('end', nextwrap);
		s.pipe(res);
	};
	this.group = 'catch-all';
	
	console.log('mod-html initialized matching path: ' + this.mountPath + ', for directory: ' + webdir);
};
