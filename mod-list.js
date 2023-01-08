const path = require('path');
const fs = require('fs');

const html_entities = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;'
};
function enc_html(str)
{
	return ((str || '') +'').replace(/[<>&]/g, c => html_entities[c]);
}
function format_mtime_ms(ms)
{
	return new Date(ms).toISOString();
}
function format_size(size)
{
	var sizes = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
	var i = 0;
	while(size >= 1024 && i+1 < sizes.length)
	{
		size /= 1024;
		++i;
	}
	return (+size).toFixed(1) + ' ' + sizes[i];
}
function match(str, matches)
{
	if(matches.length === 0) return true;

	str = (str || '') +'';

	for(var m of matches)
	{
		m.lastIndex = 0;

		if(m.test(str))
		{
			return true;
		}
	}
	return false;
}

module.exports = function(options)
{
	const webdir = path.resolve(this.__dirname || __dirname, options.webdir || this.webdir || 'public_html');
	const maxDepth = parseInt(options.maxDepth || '0'); // by default recursion is on (all subfolders)
	const robots = options.robots === true ? '' : (options.robots || ''); // disable robots by setting to noindex,nofollow
	const followSymlinks = options.followSymlinks; // defaults to false, can set to true, or: 'unsafe' which means jail can be broken
	const columns = (typeof options.columns === 'string' ? options.columns.split(',') : Array.isArray(options.columns) ? options.columns : null) || ['type', 'name', 'lastModified', 'size']; // show only the given columns, valid values are: name, lastModified, size
	var hide = (options.hide === false || options.hide === '') ? '' : (options.hide === true ? '.*' : (options.hide || '.*'));
	if(typeof hide === 'string')
	{
		hide = hide.split(',');
	}
	else if(hide && typeof hide.test === 'function')
	{
		hide = [hide];
	}
	if(!Array.isArray(hide))
	{
		console.error('mod-list: Invalid usage, bad hide type (' + (typeof hide) + '). Must be an Array.');
	}
	hide = hide.filter(m => m.trim()).map(function(m)
	{
		// escape for regex-safe string literal:
		m = m.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
		
		// enable use of basic wildcard matching:
		m = m.replace(/[\\][*]/g, '.*');
		m = m.replace(/[\\][?]/g, '.');
		
		return new RegExp('(^|/)' + m.replace() + '(/|$)', 'gi');
	});
	
	this.mountPath = options.path || '/';
	this.group = 'catch-all';
	this.middleware = async function(req, res, next)
	{
		if(res.headersSent || res.statusCode !== 200) return next();

		if(req.method !== 'GET' && req.method !== 'HEAD') return next();
		
		var reqpath = path.normalize(req.url.replace(/[?#].*$/g, '') || '/');

		// with recursion disabled, only do the listing for the specified directory, not its subfolders
		if(maxDepth > 0 && reqpath.split('/').length-1 > maxDepth) return next();

		// check for hidden directories
		if(hide.length > 0 && reqpath.split('/').filter(d => match(d, hide)).length > 0) return next();
		
		// grab webdir + reqpath
		var target_dir = path.resolve(path.join(webdir, reqpath));
		
		// check jailbreak for the path itself, not the symlink target yet (a directory outside of jail should not be listed, even if the symlink points into jail)
		if(!target_dir.startsWith(webdir)) return next();
		
		try
		{
			// check if target_dir is symlink, if symlinks are set to follow, then follow it already (so as also to check jailbreak)
			var real_target_dir = await fs.promises.realpath(target_dir);
			
			if(followSymlinks !== 'unsafe')
			{
				var real_webdir = await fs.promises.realpath(webdir); // not cached, as it may have changed, while the application is running
				
				// if nofollow, but target points somewhere else, then skip, but only from webdir, because webdir itself is allowed to be a symlink
				if(!followSymlinks && path.relative(real_webdir, real_target_dir) !== path.relative(webdir, target_dir)) return next();
	
				// check jailbreak for the real target path (but only if followSymlinks is set to unsafe)
				if(!real_target_dir.startsWith(real_webdir)) return next();
			}
	
			target_dir = real_target_dir;
		}
		catch(err)
		{
			if(err.code !== 'ENOENT')
			{
				console.error('mod-list: Unexpected error (' + reqpath + '): ', err);
			}
			console.error(err);
			return next();
		}

		try
		{
			var listing = [];
			for await (const entry of await fs.promises.opendir(target_dir))
			{
				listing.push(entry);
			}
			if(hide.length > 0)
			{
				listing = listing.filter(f => !match(f.name, hide));
			}
			listing.sort();
			
			var title = 'Index of ' + reqpath;

			res.setHeader('Content-Type', 'text/html; charset=utf-8');
			res.write('<!DOCTYPE html>\n' +
				'<html>\n' +
				'<head>\n' +
				(robots ? '\t<meta name="robots" content="' + robots + '">' : '') +
				'\t<title>' + enc_html(title) + '</title>\n' +
				'\t<style>th,td{padding: 0 1em;}</style>\n' +
				'</head>\n' +
				'<body>\n' +
				'<h1>' + enc_html(title) + '</h1>\n' +
				'<table>\n' +
				'\t<tr><th>' + columns.map(c => c.replace(/[a-z][A-Z]/g, $0 => $0.charAt(0) + ' ' + $0.charAt(1).toLowerCase()).replace(/^[a-z]/g, $0 => $0.toUpperCase())).map(c => enc_html(c)).join('</th><th>') + '</th></tr>\n' +
				(reqpath === '/' ? '' : '\t<tr><td colspan="' + columns.length + '"><a href="../">Parent directory (../)</a></td></tr>\n')
				);
			for(const entry of listing)
			{
				var isDir = entry.isDirectory();
				var entryName = entry.name;
				if(isDir) entryName += '/';

				var fstat = null;
				var file = target_dir + path.sep + entryName;

				var columnValues = [];
				for(var i=0;i<columns.length;++i)
				{
					var c = columns[i].toLowerCase().replace(/\s*|[-]/g, '');
					var value = '';
					if(c === 'type')
					{
						if(isDir)
						{
							value = 'd';
						}
						else if(entry.isFile())
						{
							value = 'f';
						}
						else if(entry.isSymbolicLink())
						{
							value = 'l';
						}
						else if(entry.isFIFO())
						{
							value = 'p';
						}
						else if(entry.isCharacterDevice())
						{
							value = 'c';
						}
						else if(entry.isBlockDevice())
						{
							value = 'b';
						}
						else if(entry.isSocket())
						{
							value = 's';
						}
					}
					else if(c === 'name')
					{
						value = '<a href="' + enc_html(entryName) + '">' + enc_html(entryName) + '</a>';
					}
					else if(c === 'lastmodified')
					{
						try
						{
							value = format_mtime_ms((fstat = fstat || await fs.promises.lstat(file)).mtimeMs);
						}
						catch(err)
						{
							value = err;
						}
					}
					else if(c === 'size')
					{
						if(isDir)
						{
							value = '-';
						}
						else
						{
							try
							{
								value = format_size((fstat = fstat || await fs.promises.lstat(file)).size);
							}
							catch(err)
							{
								value = err;
							}
						}
					}
					columnValues.push('<td>' + value + '</td>');
				}

				res.write('\t<tr>' + columnValues.join('') + '</tr>\n');
			}
			res.end('</table>\n' +
				'</body>\n' +
				'</html>\n');
		}
		catch(err)
		{
			// i.e. path does not exist, or is not a directory
			// another mod might still handle this
			if(err.code !== 'ENOTDIR')
			{
				console.error(err);
			}
		}

		next();
	};
	console.log('mod-list initialized matching path: ' + this.mountPath + ', for directory: ' + webdir + ', max depth: ' + maxDepth + ', showing columns: ' + columns.join(':') + ', hiding files matching: ' + (hide.length > 0 ? hide : 'Not hiding any files'));
};
