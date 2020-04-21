module.exports = function(options)
{
	const level = options.level || 'access';
	const method = typeof options.method === 'string' && new RegExp(options.method.replace(/[^a-z]/gi, '|'), 'gi') || options.method;
	
	this.group = 'post-process';
	this.middleware = (req, res, next) =>
	{
		if(res.headersSent)
		{
			var statusGroup = Math.floor(res.statusCode / 100);
			
			if((level === 'error' || level === 'v') && statusGroup < 5) return next();
			if((level === 'warning' || level === 'vv') && statusGroup < 4) return next();
			// if((level === 'access' || level === 'vvv') && false) return next();
			
			if(method)
			{
				method.lastIndex = 0;
				if(!method.test(req.method)) return next();
			}
			
			console.log('mod-log: ' + res.statusCode + ' ' + req.method + ' ' + req.originalUrl + ' --> ' + req.url);
		}
		else
		{
			console.log('mod-log: No headers sent for request: ' + req.method + ' ' + req.originalUrl + ' --> ' + req.url);
		}
		next();
	};
	
	console.log('mod-log initialized, logging verbosity level: ' + level + (method ? ' and filtering method: ' + method : ''));
};
