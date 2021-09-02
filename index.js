const fs = require('fs');
const express = require('express');
const path = require('path');

const MOD_GROUP_ORDER = {
	'pre-route': 100,        // redirects (path fixing)
	'pre-process': 200,      // process request (headers, fileupload)
	'catch-extension': 300,  // catch a specific extension (php, jsml)
	'catch-default': 400,    // default module catch
	'catch-all': 500,        // catch any resource (provide static resources)
	'error': 600,            // handle errors for whatever was not caught
	'post-process': 700      // process response after it has already been sent (i.e. logging, or async request processing)
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
		options = options || {};
		
		if(!(typeof options === 'object' && !Array.isArray(options)))
		{
			options = {modules: options};
		}
		
		if(typeof options.modules === 'string')
		{
			options.modules = options.modules.split(/(?<!\\),/g).map(m => m.trim());
		}
		else if(typeof options.modules === 'object')
		{
			if(Array.isArray(options.modules))
			{
				for(var i=0;i<options.modules.length;++i)
				{
					if(typeof options.modules[i] !== 'string') continue;
					if(options.modules[i].charAt(0) === '{') continue; // the whole item will already be parsed as JSON
					var submods = options.modules[i].split(/(?<!\\),/g).map(m => m.trim());
					if(submods.length > 1)
					{
						options.modules.splice.apply(options.modules, [i, 1].concat(submods));
					}
				}
			}
			else
			{
				options.modules = [options.modules];
			}
		}
		else
		{
			options.modules = ['forcedir', 'html'];
		}
		
		const DIRNAME = (module.parent ? path.dirname(module.parent.filename) : '') || __dirname;
		options.webdir = options.webdir || path.resolve(DIRNAME, 'public_html');
		
		const s = {
			_modules: []
		};
		s._MOD_GROUP_ORDER = MOD_GROUP_ORDER;
		s.mod = async function(moduleopts)
		{
			// Try parse as JSON
			if(typeof moduleopts === 'string')
			{
				try
				{
					if(moduleopts.length && moduleopts.charAt(0) === '{')
					{
						moduleopts = JSON.parse(moduleopts);
					}
				}
				catch(err) {}
			}
			// Try to check for embedded name options combination (NAME:K=V:K=V:K=V)
			if(typeof moduleopts === 'string')
			{
				// dashes are allowed in keys, which transforms some-property into someProperty
				// whatever splitter is used does not matter, as long as it is one char
				// the first part is always set to the name, the rest is set to the options for the module
				if(/^[a-z0-9./-]+[^a-z0-9./-][a-z0-9_-]+=/gi.test(moduleopts))
				{
					var splitchr = moduleopts.replace(/^[a-z0-9./-]+([^a-z0-9./-]).*$/gi, ($0, $1) => $1);
					var parts = moduleopts.split(splitchr);
					moduleopts = {name: parts.shift(), options: {}};
					for(var i=0;i<parts.length;++i)
					{
						var part = parts[i];
						var offset = part.indexOf('=');
						if(offset >= 0)
						{
							moduleopts.options[part.substring(0, offset).replace(/-[a-z]/gi, $0 => $0.charAt(1).toUpperCase())] = part.substring(offset + 1);
						}
						else
						{
							moduleopts.options[part.replace(/-[a-z]/gi, $0 => $0.charAt(1).toUpperCase())] = true;
						}
					}
				}
			}
			// Assume string is module name
			if(typeof moduleopts === 'string')
			{
				moduleopts = {name: moduleopts};
			}
			
			// set default options guaranteed to exist before requiring module
			moduleopts.__dirname = options.path || DIRNAME;
			moduleopts.webdir = moduleopts.webdir || options.webdir; // take webdir option from parent
			moduleopts.host = moduleopts.host || options.host;
			moduleopts._easywebserver = s;
			moduleopts._options = moduleopts;
			
			return new Promise(async function(resolve, reject)
			{
				// check with fs.access if we can read mod-name.js, otherwise throw error that module does not exist
				var m = moduleopts;
				if(!m.middleware)
				{
					var createfn = require(moduleopts.filename || (path.resolve(moduleopts.path || __dirname, 'mod-' + moduleopts.name + '.js')));
					if(typeof createfn !== 'function') createfn = createfn.create;
					m = (await createfn.call(moduleopts, moduleopts.options || moduleopts)) || moduleopts; // if no return value, then we assume `this` object was manipulated
				}
				m._options = moduleopts;
				m.name = moduleopts.name || m.name || moduleopts.filename || '';
				m.group = moduleopts.group || m.group || 'catch-default';
				m.priority = moduleopts.priority || m.priority || 100;
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
				if(m.name === moduleName)
				{
					m._disabled = true;
				}
			});
		};
		s.enableModule = function(moduleName)
		{
			s._modules.forEach(function(m)
			{
				if(m.name === moduleName)
				{
					m._disabled = false;
				}
			});
		};
		s.getPath = function(req)
		{
			return req.url.replace(/[?#].*$/gi, '');
		};
		s.replaceURLPath = function(match, replacement, req)
		{
			if(typeof replacement === 'object')
			{
				req = replacement;
				replacement = match;
				match = /^.*$/gi; // if no match, then replace the whole path
			}
			else if(typeof match === 'object')
			{
				match.lastIndex = 0;
			}
			var path = s.getPath(req);
			return path.replace(match, replacement) + (req.url.substring(((path || '') +'').length) || '');
		};
		s.reroute = (function()
		{
			const REROUTE_RECURSION_LIMIT = s._REROUTE_RECURSION_LIMIT || 100;
			const getFirstHandle = function(r)
			{
				if(r.handle) return r.handle;
				r = r._router || r;
				var handle = false;
				var ms = (r.stack || []);
				for(var i=0;i<ms.length;++i)
				{
					if(handle = getFirstHandle(ms[i])) return handle;
				}
				return handle;
			};
			return function(path, req, res, next)
			{
				// detect recursion (limit recursion at 100)
				if(req.reroute === path && req.rerouteCount < REROUTE_RECURSION_LIMIT)
				{
					console.error('easywebserver.reroute: Reroute recursion detected for path: ' + path + ' (' + (req.rerouteCount || 1) + 'x)');
					return res.status(500).end();
				}
				req.reroute = path;
				req.rerouteCount = (req.rerouteCount || 1) + 1;
				
				var h = getFirstHandle(req.app || s._app);
				if(typeof h !== 'function') throw new Error('easywebserver.reroute: No handle found.');
				
				req.url = s.replaceURLPath(path, req);
				
				h.call(req.app || s._app, req, res, function(){}); // no next, because reroute moves backward in the chain
			};
		})();
		s.listModuleChain = function()
		{
			var arr = [];
			s._modules.forEach(m => arr.push(m.name));
			return arr.join(' -> ');
		};
		s.listen = function(port)
		{
			const app = s._app = express.Router({strict: true});
			
			// use modmw to set the 'this' keyword as the module instance
			const modmw = function(m)
			{
				return function(req, res, next)
				{
					m.middleware.apply(m, arguments);
				};
			};
			
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
					if(m._path)
					{
						app.use(m._path, modmw(m));
					}
					else
					{
						app.use(modmw(m));
					}
				}
			});
			
			console.log(s.listModuleChain());
			
			// Final built-in module, that always ensures the response is ended
			app.use(function(req, res, next)
			{
				// catch response that didn't end yet
				if(res.headersSent)
				{
					// automatically end response, that's not a strict requirement in middleware
					if(!res.writableEnded)
					{
						res.end();
					}
					return next();
				}
				
				console.error('error: At end of module chain, URL still not caught: ' + req.originalUrl);
				res.set('Content-Type', 'text/plain; charset=UTF-8');
				res.end('Error: URL not caught: ' + req.originalUrl);
				next();
			});
			
			s._server = express({strict: true}).use(app).listen(port || 8080);
			
			return s;
		};
		
		await Promise.all(options.modules.map(s.mod));
		
		return s;
	}
};
