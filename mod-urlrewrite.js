module.exports = {
	create: function(options)
	{
		console.log('mod-urlrewrite initialized, rewrite url (path after base-servlet url) with regex');
		var mod = this;
		mod.regexes = options.regexes || [];
		mod.rewrite = function(regex)
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
				// Rewrite url with regex, usually this would be to let /page/ refer to /page.html
				for(var i=0;i<mod.regexes.length;++i)
				{
					req.url = req.url.replace(mod.regexes[i], '');
				}
				next();
			}
		};
	}
};

