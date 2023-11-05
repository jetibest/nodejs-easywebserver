const path = require('path');
const fs = require('fs');
const child_process = require('child_process');
const net = require('net');
//const phpFpm = require('php-fpm');
const express = require('express');

const fastcgiclient = (function()
{
	// new fastcgi client that does not crash
	
	const BEGIN_REQUEST_DATA_NO_KEEP_CONN = Buffer.from('\0\x01\0\0\0\0\0\0'); // FCGI_ROLE_RESPONDER && !FCGI_KEEP_CONN
	const BEGIN_REQUEST_DATA_KEEP_CONN = Buffer.from('\0\x01\x01\0\0\0\0\0'); // FCGI_ROLE_RESPONDER && FCGI_KEEP_CONN
	const MSG_TYPE = {
	    FCGI_BEGIN_REQUEST: 1,
	    FCGI_ABORT_REQUEST: 2,
	    FCGI_END_REQUEST: 3,
	    FCGI_PARAMS: 4,
	    FCGI_STDIN: 5,
	    FCGI_STDOUT: 6,
	    FCGI_STDERR: 7,
	    FCGI_DATA: 8,
	    FCGI_GET_VALUES: 9,
	    FCGI_GET_VALUES_RESULT: 10,
	    FCGI_UNKNOWN_TYPE: 11,
	    FCGI_MAXTYPE: 11
	};
	const PROTOCOL_STATUS = {
	    FCGI_REQUEST_COMPLETE: 0,
	    FCGI_CANT_MPX_CONN: 1,
	    FCGI_OVERLOADED: 2,
	    FCGI_UNKNOWN_ROLE: 3
	};
	const PADDING_BUFS = [
		Buffer.alloc(0),
		Buffer.from('\0'),
		Buffer.from('\0\0'),
		Buffer.from('\0\0\0'),
		Buffer.from('\0\0\0\0'),
		Buffer.from('\0\0\0\0\0'),
		Buffer.from('\0\0\0\0\0\0'),
		Buffer.from('\0\0\0\0\0\0\0'),
		Buffer.from('\0\0\0\0\0\0\0\0')
	];
	
	var fcgi_send = async function(socket, msgType, reqId, data)
	{
		if(socket.destroyed || socket.pending)
		{
			return new Promise(function(resolve, reject){reject(new Error('Socket is not connected' + (socket.pending ? ' yet' : '') + '.'));}); // socket is not ready yet
		}
		if(data === null)
		{
			data = PADDING_BUFS[0];
		}
		var len = data.length;
		var sendpart = async function(data, start, end)
		{
			var contentLen = end - start;
			var paddingLen = (8 - (contentLen % 8)) % 8;
			if(start || end !== len)
			{
				data = data.slice(start, end);
			}
			var buf = Buffer.alloc(8);
			buf.writeUInt8(1, 0, true);
			buf.writeUInt8(msgType, 1, true);
			buf.writeUInt16BE(reqId, 2, true);
			buf.writeUInt16BE(contentLen, 4, true);
			buf.writeUInt8(paddingLen, 6, true);
			buf.writeUInt8(0, 7, true);
			
			return new Promise(function(resolve, reject)
			{
				socket.write(buf, function()
				{
					socket.write(data, paddingLen ? function(){ socket.write(PADDING_BUFS[paddingLen], resolve); } : resolve);
				});
			});
		};
		
		var i = 0;
		while(i + 0xffff < len)
		{
			await sendpart(data, i, i += 0xffff);
		}
		await sendpart(data, i, len);
		
		return new Promise(function(resolve, reject){resolve(true);});
	};
	var fcgi_receive = (function()
	{
		var expectLen = 8;
		var restDataBufs = [];
		var restDataLen = 0;
		var msgType = 0;
		var reqId = 0;
		var restBodyLen = 0;
		var restPaddingLen = 0;
		return function(chunk, cb)
		{
			if(chunk.length + restDataLen < expectLen)
			{
				restDataBufs.push(data);
				restDataLen += data.length;
				return;
			}
			var buf = chunk;
			var len = buf.length;
			if(restDataBufs.length)
			{
				restDataBufs.push(chunk);
				len = restDataLen + data.length;
				buf = Buffer.concat(restDataBufs, len);
				restDataBufs = [];
				restDataLen = 0;
			}
			
			// process segment by segment
			var start = 0;
			var len = buf.length;
			while(len > 0)
			{
				var offset = (function(buf, start, len)
				{
					if(restBodyLen)
					{
						// in body
						if(len < restBodyLen)
						{
							restBodyLen -= len;
							cb(msgType, reqId, buf.slice(start, start + len));
							return len;
						}
						var rest = restBodyLen;
						restBodyLen = 0;
						cb(msgType, reqId, buf.slice(start, start + rest));
						if(!restPaddingLen)
						{
							expectLen = 8;
						}
						return rest;
					}
					
					if(restPaddingLen)
					{
						// in padding
						if(len < restPaddingLen)
						{
							restPaddingLen -= len;
							return len;
						}
						var rest = restPaddingLen;
						restPaddingLen = 0;
						expectLen = 8;
						return rest;
					}
					
					// head
					var headData = buf.slice(start, start + 8);
					if(headData.readUInt8(0, true) !== 1)
					{
						throw new Error('The server does not speak a compatible FastCGI protocol.');
						return 0;
					}
					msgType = headData.readUInt8(1, true);
					reqId = headData.readUInt16BE(2, true);
					restBodyLen = headData.readUInt16BE(4, true);
					restPaddingLen = headData.readUInt8(6, true);
					if(msgType === MSG_TYPE.FCGI_GET_VALUES_RESULT || msgType === MSG_TYPE.FCGI_END_REQUEST)
					{
						expectLen = restBodyLen + restPaddingLen;
					}
					else
					{
						expectLen = 0;
					}
					return 8;
				})(buf, start, len);
				start += offset;
				len -= offset;
			}
		};
	})();
	var fcgi_parseEndRequest = function(endRequest)
	{
		return {
			status: endRequest.readUInt32BE(0, true),
			protocolStatus: endRequest.readUInt8(4, true)
		};
	};
	var fcgi_encodeparams = function(params)
	{
		var bufs = [];
		var bufsLen = 0;
		for(var k in params)
		{
			var bs = (function(key, value)
			{
				value = String(value);
				var bufKey = Buffer.from(key);
				var bufValue = Buffer.from(value);
				var bufHead = null;
				var keyLen = bufKey.length;
				var valueLen = bufValue.length;
				if(keyLen > 127 && valueLen > 127)
				{
					bufHead = Buffer.alloc(8);
					bufHead.writeInt32BE(keyLen | 0x80000000, 0, true);
					bufHead.writeInt32BE(valueLen | 0x80000000, 4, true);
				}
				else if(keyLen > 127)
				{
					bufHead = Buffer.alloc(5);
					bufHead.writeInt32BE(keyLen | 0x80000000, 0, true);
					bufHead.writeUInt8(valueLen, 4, true);
				}
				else if(valueLen > 127)
				{
					bufHead = Buffer.alloc(5);
					bufHead.writeUInt8(keyLen, 0, true);
					bufHead.writeInt32BE(valueLen | 0x80000000, 1, true);
				}
				else
				{
					bufHead = Buffer.alloc(2);
					bufHead.writeUInt8(keyLen, 0, true);
					bufHead.writeUInt8(valueLen, 1, true);
				}
				return [
					bufHead,
					bufKey,
					bufValue,
					bufHead.length + keyLen + valueLen
				];
			})(k, params[k]);
			bufs.push(bs[0], bs[1], bs[2]);
			bufsLen += bs[3];
		}
		return Buffer.concat(bufs, bufsLen);
	};
	
	return function(options)
	{
		options = options || {};
		
		var self = {};
		
		self._host = options.host || '127.0.0.1';
		self._port = options.port || 9000;
		self._sockFile = options.sockFile || '';
		self._maxConns = 'maxConns' in options && options.maxConns <= 65535 ? options.maxConns : 65535;
		self._maxReqs = 'maxReqs' in options && options.maxReqs <= 65535 ? options.maxReqs : 65535;
		self._mpxsConns = !!options.mpxsConns;
		
		self._connections = [];
		
		self.request = function(params, handlers)
		{
			handlers = handlers || {};
			handlers.onconnect = handlers.onconnect || function(){};
			handlers.onstdout = handlers.onstdout || function(){};
			handlers.onstderr = handlers.onstderr || function(chunk)
			{
				// by default passthrough stderr output to process stderr
				console.error('fastcgi-client(' + socket.localAddress + ':' + socket.localPort + ' -> ' + socket.remoteAddress + ':' + socket.remotePort + '): ' + chunk);
			};
			handlers.onend = handlers.onend || function(){};
			
			if(self._connections.length >= self._maxConns)
			{
				handlers.onend(new Error('Maximum concurrent connections reached (' + self._connections.length + ').'));
				return null;
			}
			
			var socketErrors = [];
			var socket = net.createConnection(self._sockFile ? {path: self._sockFile} : {host: self._host, port: self._port});
			var endRequest = '';
			var reqId = 0;
			socket.on('connect', async function()
			{
				reqId = 1;
				
				self._connections.push(socket);
				
				socket.setKeepAlive(true);
				
				// if we want to have serial processing, we would keep conn, and wait for end-request, and then send new begin-request for next connection
				if(!await fcgi_send(socket, MSG_TYPE.FCGI_BEGIN_REQUEST, reqId, BEGIN_REQUEST_DATA_NO_KEEP_CONN).catch(console.error)) return;
				if(!await fcgi_send(socket, MSG_TYPE.FCGI_PARAMS, reqId, fcgi_encodeparams(params)).catch(console.error)) return;
				if(!await fcgi_send(socket, MSG_TYPE.FCGI_PARAMS, reqId, null).catch(console.error)) return; // why send null?
				
				var writepromise = null;
				handlers.onconnect({
					write: async function(data)
					{
						return writepromise = new Promise(function(resolve, reject)
						{
							fcgi_send(socket, MSG_TYPE.FCGI_STDIN, reqId, data).then(resolve).catch(reject);
						});
					},
					waitForWrites: async function()
					{
						if(!writepromise) return true;
						return await writepromise;
					},
					end: async function(overrideWait)
					{
						if(!overrideWait && writepromise) await writepromise;
						return await fcgi_send(socket, MSG_TYPE.FCGI_STDIN, reqId, null); // send null as EOF
					},
					abort: async function()
					{
						if(!overrideWait && writepromise) await writepromise;
						return await fcgi_send(socket, MSG_TYPE.FCGI_ABORT_REQUEST, reqId, Buffer.alloc(0));
					},
					destroy: function()
					{
						socket.end();
					}
				});
			});
			socket.on('data', function(chunk)
			{
				try
				{
					fcgi_receive(chunk, function(msgType, reqId, data)
					{
						if(msgType === MSG_TYPE.FCGI_STDOUT)
						{
							handlers.onstdout(data);
						}
						else if(msgType === MSG_TYPE.FCGI_STDERR)
						{
							handlers.onstderr(data);
						}
						else if(msgType === MSG_TYPE.FCGI_END_REQUEST)
						{
							endRequest = data;
						}
					});
				}
				catch(err)
				{
					socketErrors.push(err);
					socket.end();
				}
			});
			socket.on('error', function(err)
			{
				socketErrors.push(err);
			});
			socket.on('close', function()
			{
				// remove from connections-array
				self._connections = self._connections.filter(s => s !== socket);
				
				// socket closed
				if(socketErrors.length)
				{
					return handlers.onend(new Error(socketErrors));
				}
				if(!reqId)
				{
					return handlers.onend(new Error('Cannot send request to server (' + self._host + ':' + self._port + ').'));
				}
				
				var err = false, status = 1;
				if(endRequest)
				{
					endRequest = fcgi_parseEndRequest(endRequest);
					status = endRequest.status;//readUInt32BE(0, true);
					
					var protocolStatus = endRequest.protocolStatus;//.readUInt8(4, true);
					if(protocolStatus === PROTOCOL_STATUS.FCGI_CANT_MPX_CONN)
					{
						err = new Error('fast-cgi server rejected request: exceeds maximum number of concurrent requests.');
					}
					else if(protocolStatus === PROTOCOL_STATUS.FCGI_OVERLOADED)
					{
						err = new Error('fast-cgi server rejected request: resource not available (overloaded).');
					}
					else if(protocolStatus === PROTOCOL_STATUS.FCGI_UNKNOWN_ROLE)
					{
						err = new Error('fast-cgi server rejected request: FastCGI role not supported.');
					}
				}
				else
				{
					err = new Error('Socket closed unexpectedly (fast-cgi protocol communication not finished).');
				}
				
				handlers.onend(err, status);
			});
			
			return socket;
		};
		
		return self;
		// php.request(headers, function(err, request)
		
	};
})();


//const fastCgi = require('fastcgi-client')
const defaultOptions = {
  host: '127.0.0.1',
  port: 9000,
  documentRoot: path.dirname(require.main.filename || '.')
};

const CHAR_CODE_R = '\r'.charCodeAt(0);
const CHAR_CODE_N = '\n'.charCodeAt(0);
var parseHeader = function(header, res)
{
	// we may want to set the headers of res
	var statusCode;
	var statusMessage = '';
	var responseHeaders = {};
	var headerlines = header.split(/\r?\n/gi);
	for(var i=0;i<headerlines.length;++i)
	{
		var ln = headerlines[i];
		var colon = ln.indexOf(':');
		if(colon > 0)
		{
			var key = ln.substring(0, colon).replace(/(^\s+)|(\s+$)/gi, '');
			var value = ln.substring(colon + 1).replace(/(^\s+)|(\s+$)/gi, '');
			if(key.toLowerCase() === 'status')
			{
				statusCode = parseInt(value.replace(/^([0-9]+)(|\s+.*)$/gi, function($0, $1){return $1;}));
				statusMessage = value.replace(/^[0-9]+\s+/gi, '');
			}
			else
			{
				var arr = responseHeaders[key];
				if(!arr)
				{
					responseHeaders[key] = [value];
				}
				else
				{
					arr.push(value);
				}
			}
		}
	}
	res.writeHead(statusCode || 200, statusMessage || '', responseHeaders);
};

// custom module php-fpm, because the original module does only support php short output
// but for big output it's inefficient, and next to that, it doesn't work for other content-types such as printing images from php
const phpFpm = function(userOptions = {}, customParams = {})
{
	const options = Object.assign({}, defaultOptions, userOptions);
	const phpfpm = fastcgiclient(options);
	
	return function(req, res, next)
	{
		if(!res || res.headersSent || res.statusCode !== 200) return next();
		
		let params = Object.assign({}, customParams, {
			reqUri: req.headers['x-forwarded-original-path'] || req.headers['x-forwarded-path'] || req.url,
			uri: req.url,
			protocol: req.headers['x-forwarded-original-proto'] || req.headers['x-forwarded-proto'] || req.protocol
		});
		
		if(!params.uri || !params.uri.startsWith('/'))
		{
			throw new Error('invalid uri');
		}
		
		if(params.uri.indexOf('?') !== -1)
		{
			params.document = params.uri.split('?')[0];
			params.query = params.uri
				.slice(params.document.length + 1)
				.replace(/\?/g, '&');
		}
		
		if(!params.script)
		{
			params.script = path.join(options.documentRoot, params.document || params.uri);
		}
		
		const headers = {
			REQUEST_METHOD: req.method,
			CONTENT_TYPE: req.headers['content-type'],
			CONTENT_LENGTH: req.headers['content-length'],
			CONTENT_DISPOSITION: req.headers['content-disposition'],
			DOCUMENT_ROOT: options.documentRoot,
			SCRIPT_FILENAME: params.script,
			SCRIPT_NAME: params.script.split('/').pop(),
			REQUEST_URI: params.outerUri || params.reqUri,
			DOCUMENT_URI: params.document || params.uri,
			QUERY_STRING: params.query,
			REQUEST_SCHEME: params.protocol,
			HTTPS: params.protocol === 'https' ? 'on' : undefined,
			REMOTE_ADDR: req.connection.remoteAddress,
			REMOTE_PORT: req.connection.remotePort,
			SERVER_NAME: req.connection.domain,
			HTTP_HOST: req.headers.host,
			HTTP_COOKIE: req.headers.cookie,
			SERVER_PROTOCOL: 'HTTP/1.1',
			GATEWAY_INTERFACE: 'CGI/1.1',
			SERVER_SOFTWARE: 'php-fpm for Node',
			REDIRECT_STATUS: 200
		};
		
		// pass through all request-headers of format 'Upper-Case' as 'HTTP_UPPER_CASE' (if not set yet)
		for(const header in req.headers)
		{
			if(!Object.prototype.hasOwnProperty.call(req.headers, header)) continue;
			
			var key = 'HTTP_' + header.replace(/[-]/gi, '_').toUpperCase();
			if(!(key in headers))
			{
				headers[key] = req.headers[header];
			}
		}

		for (const header in headers)
		{
			if(typeof headers[header] === 'undefined')
			{
				delete headers[header];
			}
		}
	
		return new Promise(function(resolve, reject)
		{
			var httpheader = '';
			var headerSent = false;
			// var socket =
			phpfpm.request(headers, {
				onconnect: function(phpRequest)
				{
					try
					{
						// use read per request, so that we can wait for phpRequest.write to process the data
						// this way we keep smooth transmission pipes
						req.on('readable', async function()
						{
							var chunk;
							while((chunk = req.read()) !== null)
							{
								await phpRequest.write(chunk);
							}
						});
						req.on('end', phpRequest.end);
					}
					catch(err)
					{
						phpRequest.destroy();
						return reject(err);
					}
				},
				onstdout: function(chunk)
				{
					// but we want to remove the header, and call writeHead as soon as we have the header from stdout
					if(!headerSent)
					{
						httpheader += chunk.toString(); // to utf8
						
						var eoh = httpheader.indexOf('\r\n\r\n');
						if(eoh >= 0)
						{
							parseHeader(httpheader.substring(0, eoh), res);
							headerSent = true;
							
							// convert the part of the chunk that is read too much back to a buffer, and write to response
							res.write(Buffer.from(httpheader.substring(eoh + 4)));
						}
						return;
					}
					
					// directly write stdout to response if we are in the http body
					res.write(chunk);
				},
				onend: function(err, code)
				{
					if(err)
					{
						return reject(err);
					}
					res.end(); // end response
					resolve(); // resolve finally
				}
			});
		});
	};
};


// const PHP_DIR = '.php/';
const generateConfig = function(options)
{
	options = options || {};
	const path = ((options.path || '').replace(/\/$/gi, '') + '/').replace(/^\/$/gi, '');
	const host = options.host || '127.0.0.1';
	return [
		'[global]',
		'pid = ' + path + 'php-fpm.pid',
		'error_log = ' + path + 'error.log',
		'log_level = notice',
		'daemonize = no',
		'[www]',
		'clear_env = no', // keep environment variables, otherwise set specifically with env[PATH] = '/usr/bin:..'
		'user = ' + (options.phpUser || 'apache'),
		'group = ' + (options.phpGroup || options.phpUser || 'apache'),
		// 'chroot = ' + path, -> chroot for php-fpm is broken
		'listen = ' + host + ':' + (options.port || '8081'),
		'listen.allowed_clients = ' + (options.whitelist || (host === '127.0.0.1' ? '127.0.0.1' : 'any')),
		'pm = dynamic',
		'pm.max_children = 50',
		'pm.start_servers = 5',
		'pm.min_spare_servers = 5',
		'pm.max_spare_servers = 35',
		'slowlog = ' + path + 'www-slow.log',
		'php_admin_value[error_log] = ' + path + 'www-error.log',
		'php_admin_flag[log_errors] = on',
		'php_value[session.save_handler] = files',
		'php_value[session.save_path] = ' + path + 'session',
		'php_value[upload_max_size] = 40M',
		'php_value[post_max_size] = 40M'
	].join('\n');
};
const getPort = function(port = 9001)
{
	return new Promise(function(resolve, reject)
	{
		const server = net.createServer();
		return server
			.on('error', function(err)
			{
				if(err.code === 'EADDRINUSE')
				{
					server.listen(++port);
				}
				else
				{
					reject(err);
				}
			})
			.on('listening', function()
			{
				server.close(function()
				{
					resolve(port);
				});
			})
			.listen(port);
	});
};

module.exports = async function(options)
{
	const mod = this;
	const phpdir = options.phpPath || path.resolve(path.resolve(__dirname, options.__dirname || __dirname), '.php');
	// const webdir = path.resolve(phpdir, options.webdir || 'public_html');
	const webdir = options.webdir || mod.webdir || path.resolve(options.__dirname || __dirname, 'public_html');
	const chrootedWebdir = webdir;//webdir.indexOf(phpdir) === 0 ? webdir.substring(phpdir.length) : webdir;
	//if(chrootedWebdir === webdir)
	//{
	//	console.log('[mod-php.js] warning: webdir (' + webdir + ') is not within path (' + phpdir + '), chroot will fail.');
	//}
	const host = options.host || '127.0.0.1';
	const port = options.port || await getPort();
	this._path = options.path || '/';
	const phpUser = options.phpUser || 'apache';
	const phpGroup = options.phpGroup || options.phpUser || 'apache';
	
	await fs.promises.mkdir(phpdir).catch(function(err)
	{
		if(err.code === 'EEXIST')
		{
			return;
		}
		throw err;
	});

	await fs.promises.mkdir(path.resolve(phpdir, 'session')).catch(function(err)
	{
		if(err.code === 'EEXIST')
		{
			return;
		}
		throw err;
	});
	
	// console.log('php-fpm using documentRoot: ' + webdir + ', phpdir: ' + phpdir + ', chrooted webdir: ' + chrootedWebdir);
	const app = express.Router({strict: true});
	const phpHandler = phpFpm({
		documentRoot: chrootedWebdir,
		host: host,
		port: port
	});
	app.use(async function(req, res, next)
	{
		if(res.headersSent || res.statusCode !== 200) return next();
		
		if(/^[^?]*\.php($|[?])/gi.test(req.url))
		{
			await phpHandler(req, res, next).catch(console.error);
			next();
		}
		else
		{
			next();
		}
	});
	app.use('/', async function(req, res, next)
	{
		if(res.headersSent || res.statusCode !== 200) return next();
		
		fs.access(path.resolve(webdir, mod._options._easywebserver.getPath(req).substring(1) + 'index.php'), fs.constants.R_OK, async function(err)
		{
			if(err)
			{
				return next(); // index.php does not exist
			}
			// fix url (insert index.php after the last slash but before querystring or hash)
			// req.url = req.url.replace(/^[^?]*[/]/gi, function($0){return $0 + 'index.php';});
			// req.url = req.url.replace(/^([^#?]*\/)(.*)$/gi, function($0, $1, $2){return $1 + 'index.php' + $2;});
			req.url = mod._options._easywebserver.replaceURLPath(p => p + 'index.php', req);
			
			// console.log('running mod-php for: ' + webdir + ' -> ' + uri);
			await phpHandler(req, res, next).catch(console.error);
			next();
		});
	});
	
	const configFile = path.resolve(phpdir, 'php-fpm.conf');
	await fs.promises.writeFile(configFile, generateConfig({
		path: phpdir,
		host: host,
		port: port,
		phpUser: phpUser,
		phpGroup: phpGroup
	}));
	
	// ensure apache ownership for .php (so it can store sessions)
	child_process.exec('chown -R ' + phpUser + ':' + phpGroup + ' ' + phpdir, function(err, stdout, stderr)
	{
		if(err)
		{
			throw err;
		}
	});
	
	// run php-fpm server
	// console.log('php-fpm webdir: ' + webdir);
	var phpfpmInstance = child_process.spawn(options.exec || '/usr/sbin/php-fpm', ['--fpm-config=' + configFile]);
	phpfpmInstance.on('close', function(code)
	{
		console.log('mod-php: php-fpm crashed with code: ' + code);
		throw new Error('php-fpm crashed, check php error log in local app .php directory');
	});
	phpfpmInstance.stdout.on('data', function(chunk)
	{
		console.log('mod-php: ' + chunk);
	});
	phpfpmInstance.stderr.on('data', function(err)
	{
		console.error('mod-php: ' + err);
	});
	
	console.log('mod-php initialized php-fpm on ' + host + ':' + port + ' using configuration file: ' + configFile);
	
	this.middleware = app;
	this.group = 'catch-extension';
};
