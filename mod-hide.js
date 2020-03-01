module.exports = {
	create: function(options)
	{
		options = options || {};
		console.log('mod-hide initialized, files and directories that are intended to stay hidden cannot be accessed by a path (default=/(^|/)[.$_]/gi), the regex applies to the whole path.');
		var mod = this;
		mod.regexes = options.regexes || [/(^|\/)[.$_]/gi];
		mod.reset = function()
		{
			mod.regexes = options.regexes || [];
			return mod;
		};
		mod.hide = function(regex)
		{
			if(typeof regex === 'string')
			{
				regex = new RegExp(regex, 'gi');
			}
			mod.regexes.push(regex);
			return mod;
		};
		return {
			group: 'pre-route',
			middleware: function(req, res, next)
			{
				for(var i=0;i<mod.regexes.length;++i)
				{
					if(mod.regexes[i].test(req.url))
					{
						console.log('mod-hide: access to this url is forbidden (' + req.url + ')');
						res.status(403);
						res.end();
						return;
					}
				}
				next();
			}
		};
	}
};
