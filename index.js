const OS = require('node:os');
const Fs = require('node:fs');
const asyncFs = Fs.promises;
const Path = require('node:path');
const Net = require('node:net');
const Http = require('node:http');
const Config = require('./config');

const promisify = require('node:util').promisify;
const execFile = promisify(require('node:child_process').execFile);

const Dummy = {
	config: Config.build(),
	stats: {
		pageloads: 0,
		status404s: 0
	},
	run: {}
};

function fmtRound (value, precision) {
	const power = Math.pow(10, precision || 0);
	return String(Math.round(value * power) / power);
}

function fmtHumanReadable (value) {
	const units = ['K', 'M', 'G'];
	let unit = '';
	for (let index = 0; index < units.length && value > 1000; index++) {
		value /= 1000;
		unit = units[index];
	}
	return fmtRound(value, 1) + (unit.length > 0 ? unit : '');
}

const Stats = [
	{
		id: 'processRss',
		description: 'RSS',
		value: () => fmtHumanReadable(process.memoryUsage().rss)
	},
	{
		id: 'processHeapTotal',
		description: 'Heap Total',
		value: () => fmtHumanReadable(process.memoryUsage().heapTotal)
	},
	{
		id: 'processHeapUsed',
		description: 'Heap Used',
		value: () => fmtHumanReadable(process.memoryUsage().heapUsed)
	},
	{
		id: 'processExternal',
		description: 'Ext Memory',
		value: () => fmtHumanReadable(process.memoryUsage().external)
	},
	{
		id: 'pageloads',
		description: 'Page loads',
		value: () => fmtHumanReadable(Dummy.stats.pageloads)
	},
	{
		id: 'status404s',
		description: 'Status 404s',
		value: () => fmtHumanReadable(Dummy.stats.status404s)
	}
]

async function setupUnixSocket () {

	if (Dummy.config.flags.is_sock ) try {
		let stats = await asyncFs.stat(Dummy.config.http.path);
		if (!stats.isSocket())
			throw "Error: Cannot use http socket at " + Dummy.config.http.path;
		await asyncFs.unlink(Dummy.config.http.path);
	} catch (error) {
		if (error.errno === -OS.constants.errno.ENOENT)
			return;
		throw error;
	}
}

async function chownmodFiles () {
	const idu = await execFile('id', ['-u', Dummy.config.run.user]);
	const idg = await execFile('id', ['-g', Dummy.config.run.group]);

	const ueid = +idu.stdout;
	const geid = +idg.stdout;

	if (Dummy.config.flags.is_sock)
		await asyncFs.chown(Dummy.config.http.path, ueid, geid);

	for (let path in Dummy.config.run.chownmod) {
		const absPath = Path.join(__dirname, path);
		const modnum = Dummy.config.run.chownmod[path];

		console.log(`chownmod: ${absPath} ${modnum.toString(8)}`);
		await asyncFs.chown(absPath, ueid, geid);
		if (modnum != null)
			await asyncFs.chmod(absPath, modnum);
	}
}

async function startHttpServer () {
	Dummy.server = Http.createServer(handleRequest);
	Dummy.server.on('error', handleError);
	Dummy.server.on('listening', handleListen);
	Dummy.server.listen(Dummy.config.http);
}

async function setguidProcess () {

	process.setegid(Dummy.config.run.group);
	process.seteuid(Dummy.config.run.user);

	console.log('Running as ' +
			`${Dummy.config.run.user},${process.geteuid()}:` +
			`${Dummy.config.run.group},${process.getegid()}`);
}

function handleListen () {
	let bindStr = 'http://';
	if (Dummy.config.flags.is_inet)
		bindStr +=
			Dummy.config.http.host + ':' +
			Dummy.config.http.port;
	else if (Dummy.config.flags.is_sock)
		bindStr +=
			'unix:' + Dummy.config.http.path;
	console.log('Listening on: ' + bindStr);
}


function handleError (error) {
	console.log(error);
	process.exit(1);
}

function handleRequest  (request, response) {
	console.log(`Request ${request.method} ${request.url}`);

	if (request.method === 'GET') {
		if (request.url === '/') {
			updateRequestStats(request, response);
		    	response.setHeader('Content-Type', 'text/html');
			serveFileAsync(Path.join(__dirname, '/index.html'), response);
			return;
		}
		response.writeHead(404).end();
	}
	response.writeHead(500).end();
}

function serveFileAsync (path, response) {
    const readStream = Fs.createReadStream(path);

    return new Promise((finish, reject) => {
        readStream.pipe(response);
        readStream.on('end', () => {
		console.log("Read " + path);
		readStream.close();
		response.end();
		finish();
        });
        readStream.on('error', (error) => {
		console.log('Read 404 ' + error.code + ' ' + path);
		response.writeHead(404).end();
		Dummy.stats.status404s++;
        });
    });
}

function updateRequestStats (request, response) {
	Dummy.stats.pageloads++;
}

function sendStats () {

	const request = {
		serviceName: Dummy.config.run.name,
		reset: true,
		stats: []
	};

	for (let stat of Stats) {
		request.stats.push({
			id: stat.id,
			description: stat.description,
			value: stat.value()
		});
	}

	const paddle = Net.createConnection(Dummy.config.run.paddleSock, () => {
		const message = JSON.stringify(request);
		paddle.end(message);
	});
	paddle.on('error', (error) => console.log(`[Paddle] ${error}`));
	paddle.on('end', () => paddle.destroy());
}

Promise.resolve({})
	.then(setupUnixSocket)
	.then(startHttpServer)
	.then(chownmodFiles)
	.then(setguidProcess);

Dummy.run.statsInterval = setInterval(
	sendStats,
	Dummy.config.run.updateInterval);

