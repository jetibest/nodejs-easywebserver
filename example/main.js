const easywebserver = require('../');

easywebserver.create('forcedir,html').then(s => s.listen(parseInt(process.argv[2])));
