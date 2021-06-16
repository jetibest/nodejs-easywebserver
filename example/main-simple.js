require('../../nodejs-easywebserver/').create('forcedir,php,html,404,log').then(s => s.listen(parseInt(process.argv[2]))).catch(console.error);
