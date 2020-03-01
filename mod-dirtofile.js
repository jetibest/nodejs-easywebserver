const fs = require('fs');
const path = require('path');

var findExtension = function(req, filepath, extensions, next)
{
	if(!extensions.length)
	{
		return next();
	}
	var extension = extensions.shift();
	fs.access(filepath + extension, fs.constants.R_OK, function(err, res)
	{
		if(err)
		{
			return findExtension(req, filepath, extensions, next);
		}
		req.url = req.url.replace(/\/$/gi, '') + extension; // rewrite url, as we found the file
		next();
	});
};

module.exports = {
	create: function(options)
	{
		var mod = this;
		options = options || {};
		mod.extensions = options.extensions || ['.html', '.htm', '.php', '.asp', '.aspx', '.jsp', '.cgi'];
		mod.extensions.unshift(''); // for coding convenience the first check is no extension added
		mod.reset = function()
		{
			mod.extensions = options.extensions || [];
			mod.extensions.unshift('');
			return mod;
		};
		mod.add = function(extension)
		{
			mod.extensions.push('.' + extension.replace(/^\./gi, ''));
			return mod;
		};
		console.log('mod-dirtofile initialized, tries to add extensions, while target does not exist (/page/ may match /page.html)');
		return {
			group: 'pre-route',
			middleware: function(req, res, next)
			{
				// directory paths will automatically be updated to file, if directory does not exist, but a file with any extension does
				// e.g. /page/ will refer to /page.html if page does not exist and page.html does
				if(!req.url || req.url === '/')
				{
					return next(); // special case for the current root directory
				}
				findExtension(
					req,
					path.resolve(mod.webdir, req.url.replace(/^\//gi, '')),
					mod.extensions.slice(0),
					next
				);
			}
		};
	}
};

