const fs = require('fs');
const path = require('path');

module.exports = function(options)
{
	var mod = this;
	var extensions = [];
	var findExtension = function(req, filepath, extensions, next)
	{
		if(!extensions.length) return next();
		
		var extension = extensions.shift();
		fs.access(filepath + '.' + extension, fs.constants.R_OK, function(err, res)
		{
			if(err) return findExtension(req, filepath, extensions, next);
			
			req.url = mod._options._easywebserver.replaceURLPath(/\/?$/i, '.' + extension, req);
			next();
		});
	};
	
	mod.set = function(arr)
	{
		if(!arr) return;
		if(typeof arr === 'string')
		{
			arr = arr.split(',').map(ext => ext.replace(/^\./gi, ''));
		}
		extensions = arr;
	};
	mod.add = function(extension)
	{
		extensions.push(extension.replace(/^\./gi, ''));
		return mod;
	};
	mod.group = 'pre-route';
	mod.middleware = function(req, res, next)
	{
		// directory paths will automatically be updated to file, if directory does not exist, but a file with any extension does
		// e.g. /page/ will refer to /page.html if page-directory does not exist and page.html does
		var reqPath = mod._options._easywebserver.getPath(req);
		
		// special case for the current root directory or if no trailing slash
		if(!reqPath || reqPath === '/' || !(/(\/)?$/gi.test(reqPath))) return next();
		
		// check if directory exists
		var filepath = path.resolve(mod.webdir, reqPath.replace(/^\//gi, ''));
		fs.access(filepath, fs.constants.R_OK, function(err, res)
		{
			if(!err) return next(); // no error, so directory exists already
			
			findExtension(
				req,
				filepath,
				extensions.slice(0), // will be shifted, so pass a copy
				next
			);
		});
	};
	
	mod.set(options.extensions || 'html,htm,php,asp,aspx,jsp,cgi');
	console.log('mod-dirtofile initialized, tries to add extensions (' +  extensions + '), while target does not exist (/page/ may match /page.html)');
	
	return mod;
};

