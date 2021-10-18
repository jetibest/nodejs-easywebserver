module.exports = function(options)
{
	this.group = 'pre-route';
	this.middleware = function(req, res, next)
	{
		req.locals = req.locals || {};
		var map = req.locals.id = req.locals.id || {};
		var path = req.url.replace(/[?#].*$/gi, '').split('/');
		var newpath = [];
		for(var i=0;i<path.length;++i)
		{
			var part = path[i];
			var colon = part.indexOf(':');
			if(colon > 0)
			{
				var key = part.substring(0, colon);
				map[key] = part.substring(colon + 1);
				newpath.push(key);
			}
			else
			{
				newpath.push(part);
			}
		}
		req.url = newpath.join('/') + req.url.replace(/^.*([?#].*)?$/gi, ($0, $1) => $1 || '');
		next();
	};
	
	console.log('mod-pathid initialized, tries to turn path /item:123/ to /item/ while setting request.locals.id["item"] = 123');
	
	return this;
};

