module.exports = {
	create: function(options)
	{
		console.log('mod-forcedir initialized, if using proxy, put the original path in header: x-forwarded-original-path');
		return {
			group: 'pre-route',
			middleware: function(req, res, next)
			{
				var originalPath = req.headers[options.header || options.headerOriginalPath || 'x-forwarded-original-path'];
				if(typeof originalPath !== 'string')
				{
					originalPath = req.path;
				}
				// if using a proxy, it has to provide the original path in a header
				// redirect /app to /app/, ensure a trailing slash
				// or in general case: if no file-extension, it should be a directory with trailing slash
				originalPath = originalPath.replace(/\?.*$/gi, '');
				if(req.path.indexOf('.') === -1 && originalPath.substr(-1) !== '/')
				{
					res.redirect(302, originalPath + '/' + req.url.slice(req.path.length));
					return;
				}
				next();
			}
		};
	}
};
