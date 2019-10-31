const fs = require('fs');
const express = require('express');
const path = require('path');

const MOD_GROUP_ORDER = {
	'pre-route': 100,        // redirects (path fixing)
	'pre-process': 200,      // process request (headers, fileupload)
	'catch-extension': 300,  // catch a specific extension (php, jsml)
	'catch-default': 400,
	'catch-all': 500,       // catch any resource (provide static resources)
	'post-process': 600     // process response
};

const self = module.exports = {
	create: function(options, cb)
	{
		if(typeof options === 'function')
		{
			cb = options;
			options = {};
		}
		if(cb)
		{
			return self.createAsync(options).then(cb);
		}
		return self.createAsync(options);
	},
	createAsync: async function(options)
	{
		if(typeof options === 'string')
		{
			options = {modules: options.split(',')};
		}
		else if(typeof options === 'object' && Array.isArray(options))
		{
			options = {modules: options};
		}
		const DIRNAME = (module.parent ? path.dirname(module.parent.filename) : '') || __dirname;
		options = options || {};
		options.webdir = options.webdir || path.resolve(DIRNAME, 'public_html');
		options.modules = options.modules || ['forcedir', 'html'];
		
		const s = {
			_modules: []
		};
		s.mod = async function(module)
		{
			if(typeof module === 'string')
			{
				module = {name: module};
			}
			module.__dirname = options.path || DIRNAME;
			module.webdir = module.webdir || options.webdir; // take webdir option from parent
			module.host = module.host || options.host;
			return new Promise(async function(resolve, reject)
			{
				// check with fs.access if we can read mod-name.js, otherwise throw error that module does not exist
				var m;
				if(module.middleware)
				{
					m = module;
				}
				else
				{
					m = await require(module.filename || (path.resolve(module.path || __dirname, 'mod-' + module.name + '.js'))).create.call(module, module.options || module);
				}
				m._options = module;
				m.group = module.group || m.group || 'catch-default';
				m.priority = module.priority || m.priority || 100;
				s._modules.push(m);
				resolve(m);
			});
		};
		s.printModules = function()
		{
			// list currently used modules and their options/configuration

		};
		s.disableModule = function(moduleName)
		{
			s._modules.forEach(function(m)
			{
				if(m._options.name === moduleName)
				{
					m._disabled = true;
				}
			});
		};
		s.enableModule = function(moduleName)
		{
			s._modules.forEach(function(m)
			{
				if(m._options.name === moduleName)
				{
					m._disabled = false;
				}
			});
		};
		s.listen = function(port)
		{
			const app = express.Router({strict: true});
			
			s._modules.sort(function(a, b)
			{
				if(a.group === b.group)
				{
					return (a.priority || 0) - (b.priority || 0);
				}
				return MOD_GROUP_ORDER[a.group] - MOD_GROUP_ORDER[b.group];
			});	
			
			s._modules.forEach(function(m)
			{
				if(m && !m._disabled)
				{
					if(m.path)
					{
						console.log('app.use ' + m.path + ', ' + m._options.name);
						app.use(m.path, m.middleware);
					}
					else
					{
						console.log('app.use ' + m._options.name);
						app.use(m.middleware);
					}
				}
			});
			
			s._server = express({strict: true}).use(app).listen(port || 8080);
			
			return s;
		};
		
		await Promise.all(options.modules.map(s.mod));
		
		return s;
	}
};
