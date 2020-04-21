const modReroute = require('./mod-reroute.js');

module.exports = function(options)
{
	(modReroute.create || modReroute).call(this, options);
};
