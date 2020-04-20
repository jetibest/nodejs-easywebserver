const path = require('path');
const express = require('express');

module.exports = function(options)
{
	const mod = this;
	const webdir = options.webdir || path.resolve(options.__dirname || __dirname, 'public_html');
	const staticmiddleware = express.static(webdir);
	
	this._path = options.path || '/';
	this.middleware = function(req, res, next)
	{
		if(res.headersSent) return next();
		
		staticmiddleware(req, res, next);
	};
	this.group = 'catch-all';
	
	console.log('mod-html initialized matching path: ' + this._path + ', for directory: ' + webdir);
};
