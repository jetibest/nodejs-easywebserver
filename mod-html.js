const path = require('path');
const express = require('express');

module.exports = {
	create: function(options)
	{
		options = options || {};
		return {
			middleware: (function()
			{
				const webdir = options.webdir || path.resolve(options.__dirname || __dirname, 'public_html');
				console.log('html-mod initialized for directory: ' + webdir);
				const fnc = express.static(webdir);
				return fnc;
				// return function(req, res, next)
				// {
					// console.log('running mod-html for ' + req.url);
					// fnc(req, res, next);
				// };
			})(),
			path: '/',
			group: 'catch-all'
		};
	}
};
