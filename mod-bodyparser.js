const path = require('path');
const fs = require('fs');
const bodyParser = require('body-parser');

module.exports = function(options)
{
	// You may use this module to reroute the request to a given path when a certain match took place
	// The difference with mod-urlrewrite is that this function does an internal redirect back to the start
	var limit = options.limit || '16mb';
	var parsers = options.parsers || [
        'json',
        'urlencoded'
    ];
    if(typeof parsers === 'string') parsers = parsers.split(',').map(str => str.trim()).filter(str => str.length > 0);
    parsers = parsers.map(parser =>
        typeof parser === 'function' ? parser : bodyParser[parser].apply(bodyParser[parser], parser === 'urlencoded' ? [{limit: limit, extended: false}] : [{limit: limit}]);
    );
	
	this.group = 'pre-process';
	this.middleware = (req, res, next) =>
	{
		if(!res || res.headersSent || res.statusCode !== 200) return next();
		
		for(var i=0;i<parsers.length;++i)
		{
            await new Promise((resolve, reject) =>
            {
                try
                {
                    parsers[i].call(this, req, res, resolve);
                }
                catch(err)
                {
                    reject(err);
                }
            });
		}
	};
	
	console.log('mod-bodyparser initialized with ' + parsers.length + ' bodyparser instances, with maximum request body size limit: ' + limit);
};
