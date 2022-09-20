const OS = require('node:os');
const Fs = require('node:fs').promises;
const Http = require('node:http');
const Config = require('./config');

const promisify = require('node:util').promisify;
const execFile = promisify(require('node:child_process').execFile);

const dummy = {
	config: Config.build()
};

async function setupUnixSocket () {

	try {
		let stats = await Fs.stat(dummy.config.http.path);
		if (!stats.isSocket())
			throw "Error: Cannot use http socket at " + dummy.config.http.path;
	
	} catch (error) {

		if (error.errno === -OS.constants.errno.ENOENT)
			return;

		throw error;
	}

	await Fs.unlink(dummy.config.http.path);
}

async function chownUnixSocket () {
	const idu = await execFile('id', ['-u', dummy.config.run.user]);
	const idg = await execFile('id', ['-g', dummy.config.run.group]);

	const ueid = +idu.stdout;
	const geid = +idg.stdout;

	await Fs.chown(dummy.config.http.path, ueid, geid);
}

async function startHttpServer () {
	
	if (dummy.config.flags.is_sock)
		await setupUnixSocket();

	dummy.server = Http.createServer(handleRequest);
	dummy.server.on('error', handleError);
	dummy.server.on('listening', handleListen);
	dummy.server.listen(dummy.config.http);

	if (dummy.config.flags.is_sock)
		await chownUnixSocket();
}

async function setguidProcess () {

	process.setegid(dummy.config.run.group);
	process.seteuid(dummy.config.run.user);

	console.log('Running as ' +
			`${dummy.config.run.user},${process.geteuid()}:` +
			`${dummy.config.run.group},${process.getegid()}`);
}


function handleListen () {
	let bindStr = 'http://';
	if (dummy.config.flags.is_inet)
		bindStr +=
			dummy.config.http.host + ':' +
			dummy.config.http.port;
	else if (dummy.config.flags.is_sock)
		bindStr +=
			'unix:' + dummy.config.http.path;
	console.log('Listening on: ' + bindStr);
}


function handleError (error) {
	console.log(error);
	process.exit(1);
}

function handleRequest  (request, response) {
	notifyRequest();
	console.log('Request: ', request);
	response.writeHead(200, { 'Content-Type': 'text/plain' });
	response.end('Hello back');
}

function notifyRequest () {
	if (typeof process.env.REQUESTS === 'undefined')
		process.env.REQUESTS = 0;
	process.env.REQUESTS++;
}

Promise.resolve({})
	.then(startHttpServer)
	.then(setguidProcess);
