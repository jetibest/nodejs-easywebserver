module.exports = function(options)
{
	var header = options.header || options.headerOriginalPath || 'x-forwarded-original-path';
	const mod = this;
	this.group = 'pre-route',
	this.middleware = function(req, res, next)
	{
		var originalPath = req.headers[header];
		if(typeof originalPath !== 'string')
		{
			originalPath = mod._options._easywebserver.getPath(req);
		}
		else
		{
			originalPath = originalPath.replace(/[?#].*$/gi, ''); // ensure path from header does not contain querystring or hash
			originalPath = originalPath.replace(/^[^/]+:\/\//gi, '').replace(/^[^/]*/gi, ''); // remove the protocol/hostname/port
		}
		// if using a proxy, it has to provide the original path in a header
		// redirect /app to /app/, ensure a trailing slash
		// or in general case: if no file-extension, it should be a directory with trailing slash
		
		
		// if trailing slash, or a dot (extension) is found, then do not redirect
		if(originalPath.indexOf('.') !== -1 || originalPath.substr(-1) === '/') return next();
		
		req.url = mod._options._easywebserver.replaceURLPath(p => p + '/', req);
		
		res.redirect(302, req.url);
		next();
	};
	
	console.log('mod-forcedir initialized, if using proxy, put the original path in header: x-forwarded-original-path');
};
