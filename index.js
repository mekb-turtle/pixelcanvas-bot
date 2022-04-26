(async()=>{
const axios = require("axios");
const Jimp = require("jimp");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
let unknown;
let opt = {
	string: [ "file", "output", "expiry", "delay" ],
	boolean: [ "help", "random", "reverse", "dither", "white", "ignore", "quiet", "debug", "noexisting", "noshorten", "verbose" ],
	alias: {
		"help": [ "?" ],
		"file": [ "f" ],
//		"width": [ "w" ], // resizing currently doesn't work
//		"height": [ "h" ],
		"ewidth": [ "W" ],
		"eheight": [ "H" ],
		"ex": [ "X" ],
		"ey": [ "Y" ],
		"noexisting": [ "O" ],
		"dither": [ "d" ],
		"x": [ "x_" ], // this is required otherwise it'll think this is unknown
		"y": [ "y_" ],
		"noshorten": [ "N" ],
		"random": [ "r" ],
		"reverse": [ "R" ],
		"white": [ "i" ],
		"ignore": [ "I" ],
		"debug": [ "D" ],
		"quiet": [ "q" ],
		"output": [ "o" ],
		"expiry": [ "e" ],
		"verbose": [ "v" ],
		"delay": [ "Q" ],
	},
	unknown: (e) => { unknown = e; },
};
const argv = require("minimist")(process.argv.splice(2), opt);
if (argv.help) {
	process.stderr.write("image:\n");
	process.stderr.write("  --file -f            what file to draw\n");
	process.stderr.write("  -x                   left-most pixel of the image\n");
	process.stderr.write("  -y                   top-most pixel of the image\n");
	process.stderr.write("use -x-5 or -x=-5 for negative numbers, -x -5 won't work\n");
//	process.stderr.write("  --width -w           width of image\n");
//	process.stderr.write("  --height -h          height of image\n");
//	process.stderr.write("if both width and height are left out, image size will be left as is\n");
	process.stderr.write("  --random -r          draw each pixel in a random order\n");
	process.stderr.write("  --reverse -R         reverse order to draw pixels\n");
	process.stderr.write("  --dither -d          dither the image\n");
	process.stderr.write("  --white -i           don't draw white pixels, act as if all pixels are white by default\n");
	process.stderr.write("  --ignore -I          don't check existing pixels, makes --expiry useless\n");
	process.stderr.write("  --expiry -e          expiry time of chunk cache for existing pixels, default: 1h\n");
	process.stderr.write("  --delay -Q           delay after placing every pixel, default is 1,10 = random 1 second to 10 seconds, 5 = 5 seconds, none/null/0/0,0 = no delay\n");
	process.stderr.write("output:\n");
	process.stderr.write("  --noshorten -N       don't shorten multiple skipped pixels into one line");
	process.stderr.write("  --debug -D           don't actually draw anything, just say what would be drawn unless --quiet is specified\n");
	process.stderr.write("  --quiet -q           don't output anything, does nothing if --debug is specified and not --output\n");
	process.stderr.write("  --output -o          output image of what would be drawn to a file, use with -D and -q\n");
	process.stderr.write("  --noexisting -O      don't show existing pixels with -o, defaults to yes if -x and -y are left out\n");
	process.stderr.write("  --ex -X              left-most pixel for --output\n");
	process.stderr.write("  --ey -Y              top-most pixel for --output\n");
	process.stderr.write("  --ewidth -W          width for --output\n");
	process.stderr.write("  --eheight -H         height for --output\n");
	process.stderr.write("other:\n");
	process.stderr.write("  --verbose -v         show full error instead of short description\n");
	process.stderr.write("  --help -?            help\n\n");
	return 8;
}
for (i in argv) { if (argv[i] === false) argv[i] = null; }; // i probably put some if (argv.__ != null) instead of if (argv.__) somewhere so this will fix it
if (unknown == null && argv._.length) unknown = argv._[0];
if (unknown) {
	console.error("Unexpected", unknown);
	return 7;
}
for (let i = 0; i < opt.boolean.length; ++i) {
	if (typeof argv[opt.boolean[i]] != "boolean" && argv[opt.boolean[i]] != null) { // there's a way to make these boolean arguments actually a string, so this fixes it
		console.error("Wrong type -" + (opt.boolean[i].length > 1 ? "-" : "") + opt.boolean[i]);
		return 7;
	}
}
for (let i = 0; i < opt.string.length; ++i) {
	if (typeof argv[opt.string[i]] != "string" && argv[opt.string[i]] != null) { // maybe string too, i'm not sure
		console.error("Wrong type -" + (opt.string[i].length > 1 ? "-" : "") + opt.string[i]);
		return 7;
	}
}
const random = (a, b) => {
	if (b == null) [ a, b ] = [ 0, a ]; // if only max is specified, make it from 0 to max
	return Math.floor((Math.random() * (b - a) + a) * 1e3);
}
const isStr = (e, a) => { // functions to check argument makes sense
	if (typeof e != "string" || e == null || e == "") {
		console.error(`Missing ${a}`);
		return true;
	}
}
const isNum = (e, a, p) => {
	if (typeof e != "number" || e != Math.floor(e) || e >= 1e9 || e <= (p ? 0 : -1e9)) {
		console.error(e == null ? `Missing ${a}` : `Invalid ${a}`);
		return true;
	}
}
if (argv.output != null) {
	if (isStr(argv.output, "--output")) return 7;
	argv.output = path.resolve(argv.output);
}
if (!argv.debug || argv.file != null) {
	if (isStr(argv.file, "--file")) return 7;
	argv.file = path.resolve(argv.file);
}
if ((argv.file && !argv.debug) || argv.x != null || argv.y != null) {
	if (isNum(argv.x, "-x")) return 7;
	if (isNum(argv.y, "-y")) return 7;
	if (argv.width != null || argv.height != null) {
		if (isNum(argv.width,  "--width", true))  return 7;
		if (isNum(argv.height, "--height", true)) return 7;
	}
}
let isE = false;
if (argv.output) { // different logic depending on different arguments
	if (argv.ewidth != null || argv.eheight != null || argv.ex != null || argv.ey != null) {
		if (argv.existing) {
			console.error("--existing specified without --file"); return 7;
		}
		if (isNum(argv.ex,      "-X"))              return 7;
		if (isNum(argv.ey,      "-Y"))              return 7;
		if (isNum(argv.ewidth,  "--ewidth", true))  return 7;
		if (isNum(argv.eheight, "--eheight", true)) return 7;
		isE = true;
	} else if (!argv.file) {
		console.error("No --file or -WHXY argumets specified"); return 7;
	}
} else {
	if (argv.ewidth != null)  console.error("--ewidth ignored");
	if (argv.eheight != null) console.error("--eheight ignored");
	if (argv.ex != null)      console.error("-X ignored");
	if (argv.ey != null)      console.error("-Y ignored");
	if (argv.noexisting)      console.error("--noexisting ignored");
}
if (argv.ignore && argv.expiry != null) console.error("--expiry ignored");
if (argv.expiry == null) argv.expiry = "1h";
if (argv.output != null && (argv.x == null || argv.y == null)) { console.error("--noexisting enabled as -x and -y are left out"); argv.noexisting = true; }
else if (argv.debug && argv.noexisting && (argv.x != null || argv.y != null)) console.error("-x -y ignored");
if (argv.quiet && argv.noshorten) console.error("--noshorten ignored");
if (isStr(argv.expiry, "--expiry")) return 7;
let expiryMatch = argv.expiry.match(/^(?:([0-6])d)?(?:([0-9]|1[0-9]|2[0-3])h)?(?:([0-9]|[1-5][0-9])m)?(?:([0-9]|[1-5][0-9])s)?$/i);
if (!expiryMatch) { console.error("Invalid --expiry"); return 7; }
let expiryTime = 0;
if (expiryMatch[1]) expiryTime += parseInt(expiryMatch[1]) * 24 * 3600e3;
if (expiryMatch[2]) expiryTime += parseInt(expiryMatch[2]) * 3600e3;
if (expiryMatch[3]) expiryTime += parseInt(expiryMatch[3]) * 60e3;
if (expiryMatch[4]) expiryTime += parseInt(expiryMatch[4]) * 1e3;
delete expiryMatch;
if (argv.delay == "none" || argv.delay == "null") argv.delay = "0,0";
if (argv.delay == null) argv.delay = "1,10";
if (isStr(argv.delay, "--delay")) return 7;
let delayMatch = argv.delay.match(/^([0-9]|[1-9][0-9]{1,2}|[12][0-9]{3}|3[0-5][0-9]{2})(?:,([0-9]|[1-9][0-9]{1,2}|[12][0-9]{3}|3[0-5][0-9]{2}))?$/);
if (!delayMatch) { console.error("Invalid --delay"); return 7; }
let minDelay = parseInt(delayMatch[1]);
let maxDelay = delayMatch[2] ? parseInt(delayMatch[2]) : minDelay;
if (argv.debug && argv.quiet && !argv.output) { console.error("Nothing will happen"); return 0; }
if (!argv.x) argv.x = 0; if (!argv.y) argv.y = 0;
const logError = err => {
	console.error(argv.verbose ? err : err.response ? `${err.name}: ${err.message}` : err.stack);
	if (err.response?.status == 401) {
		console.error("Your firebase token or fingerprint is invalid, refer to README.md for instructions");
	}
}
const paletteFile = path.resolve(__dirname, "./palette.png"); // read palette image
const palette = await Jimp.read(paletteFile);
let colors_ = [];
palette.scan(0, 0, palette.bitmap.width, palette.bitmap.height, (x, y, i) => {
	if (palette.bitmap.data[i + 3] > 127) // make sure the color isn't transparent
		colors_.push([palette.bitmap.data[i + 0], palette.bitmap.data[i + 1], palette.bitmap.data[i + 2]]); // no need for alpha
});
const colors = colors_; delete colors_;
let oldPwd = process.cwd();
process.chdir(__dirname);
require("dotenv").config();
process.chdir(oldPwd);
const ax = axios.create({
	baseURL: "http://localhost:8080/",
	timeout: 10000,
});
const chunkSize = 256;
const chunkCache = {};
const getChunk = async (cx, cy) => {
	let cacheName = `${cx}.${cy}`;
	if (Date.now() - expiryTime > chunkCache[cacheName]?.creation) {
		delete chunkCache[cacheName];
	}
	if (!chunkCache[cacheName]) {
		let res = await ax({
			method: "get",
			url: `chunk?x=${cx}&y=${cy}&format=color`,
			responseType: "arraybuffer"
		});
		chunkCache[cacheName] = { creation: Date.now(), data: res.data };
	}
	return chunkCache[`${cx}.${cy}`];
};
// mod converts a position to the position in that chunk
const mod = (e) => e==0?0: e<0 ? chunkSize-1-(-e-1)%chunkSize : e%chunkSize;
// div converts a position to what chunk it's in
const div = (e) => e==0?0: Math.floor(e/chunkSize);
// gets the color of the pixel at a position
const getPixel = async (x, y) => (await getChunk(div(x),div(y))).data[mod(x)+mod(y)*chunkSize];
const doSleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const upLine = "\x1b[1A";
const startOfLine = "\x1b[2K\x1b[0G";
let consecutiveSkips = 0;
const shortenSkipThreshold = 21;
const drawPixel = async ({ x, y, color }) => {
	let skipped = argv.debug ? false : (color == await getPixel(x, y));
	if (!argv.noshorten && skipped) {
		++consecutiveSkips;
	} else {
		if (consecutiveSkips >= shortenSkipThreshold) process.stdout.write("\n");
		consecutiveSkips = 0;
	}
	if (!argv.noshorten) {
		if (consecutiveSkips == shortenSkipThreshold) process.stdout.write(`${startOfLine}${upLine}`.repeat(consecutiveSkips-1));
		if (consecutiveSkips >= shortenSkipThreshold) process.stdout.write(`${startOfLine}Skipped ${consecutiveSkips} pixels`);
	}
	if (consecutiveSkips < shortenSkipThreshold && !argv.quiet)
		console.log((skipped ? "Skipped d" : "D") + "rawing pixel at", x, y, "with color", (color + 1).toString().padStart(2, 0));
	if (argv.debug) return { };
	if (skipped) return { };
	let res = await ax({
		method: "put",
		url: `place?x=${x}&y=${y}&color=${color}`,
	});
};
const dist3d = (x1, y1, z1, x2, y2, z2) => Math.sqrt(((x1-x2)**2) + ((y1-y2)**2) + ((z1-z2)**2));
const nearest = (r, g, b) => { // get nearest color
	let j;
	let dist = Infinity; // start at infinity, too lazy for null check
	for (let i = 0; i < colors.length; ++i) {
		let newDist = dist3d(r, g, b, ...colors[i]);
		if (newDist < dist) {
			dist = newDist;
			j = i;
		}
	}
	return j;
};
let image;
if ((argv.width && argv.height) || argv.dither) {
	const buf = await (await Jimp.read(argv.file)).getBufferAsync("image/png");
	// get Jimp to convert to PNG. if a user puts "png:-" for the file name,
	// magick will think we're putting the file in through stdin, and it'll hang.
	// this is a hacky work around
	var proc = spawn("magick", [
		"convert",
		...(argv.width && argv.height ? [
			// set flags if resizing, Jimp's resize is weird
			"-size", `${argv.width}x${argv.height}`
		] : []),
		...(argv.dither ? [
			// set flags if dithering
			"-dither", "FloydSteinberg", "-remap", paletteFile,
		] : []),
		"--", "png:-", "png:-" // input = stdin png, output = stdout png
	]);
	let buffers = [];
	proc.stdout.on("data", b => buffers.push(b)); // add the buffer to array
	proc.stdin.write(buf); // write the PNG image data
	delete buf; // don't need anymore
	proc.stdin.end(); // we're not writing anymore, close stdin
	await new Promise((resolve, reject) => {
		proc.once("error", reject);
		proc.once("exit", (c) => {
			if (c > 0) reject("magick exited with code", c);
			resolve();
		});
	});
	// concat the buffers into one and get Jimp
	// the output image won't have this if we use nearest in the scan function instead
	image = await Jimp.read(Buffer.concat(buffers));
	delete buffers; // don't need anymore
} else {
	image = await Jimp.read(argv.file);
}
image.scan(0, 0, image.bitmap.width, image.bitmap.height, (x, y, i) => {
	let [ r, g, b, a ] = image.bitmap.data.slice(i, i+4); // destructuring assignment OP
	if (a > 127) {
		[ r, g, b ] = colors[nearest(r, g, b)]; // get nearest color
		a = 255;
	} else {
		r = g = b = a = 0;
	}
	// set color to the nearest
	image.bitmap.data[i+0] = r;
	image.bitmap.data[i+1] = g;
	image.bitmap.data[i+2] = b;
	image.bitmap.data[i+3] = a;
});
if (argv.output) {
	if (argv.noexisting) {
		// just write the image if don't need to change the background
		await fs.promises.writeFile(argv.output, await image.getBufferAsync("image/png"));
	} else {
		// get position and size
		let ex = isE ? argv.ex : argv.x;
		let ey = isE ? argv.ey : argv.y;
		let ewidth = isE ? argv.ewidth : image.bitmap.width;
		let eheight = isE ? argv.eheight : image.bitmap.height;
		image2 = await Jimp.create(ewidth, eheight);
		try {
			for (let y = 0; y < eheight; ++y) {
				for (let x = 0; x < ewidth; ++x) {
					// new color
					let ox = ex-argv.x+x;
					let oy = ey-argv.y+y;
					let oox = ox<0 || ox>=image.bitmap.width;
					let ooy = oy<0 || oy>=image.bitmap.height;
					let oc = oox || ooy ? 0 : image.getPixelColor(ox, oy);
					if (oc & 0xff > 127) {
						image2.setPixelColor(oc, x, y);
					} else {
					// original color from pixelcanvas
						let c = await getPixel(x+ex, y+ey);
						image2.setPixelColor(Jimp.rgbaToInt(...colors[c], 255), x, y);
					}
				}
			}
		} catch (err) { logError(err); }
		await fs.promises.writeFile(argv.output, await image2.getBufferAsync("image/png"));
	}
}
let pixels = [];
image.scan(0, 0, image.bitmap.width, image.bitmap.height, (x, y, i) => {
	let [ r, g, b, a ] = image.bitmap.data.slice(i, i+4);
	if (a > 127) {
		let X = x + argv.x;
		let Y = y + argv.y;
		// don't need to use nearest twice
		let color = colors.map(e => e.join()).indexOf([r, g, b].join());
		// indexOf doesn't work with an array of arrays, but array of strings work
		if (color == 0 && argv.white) return;
		pixels.push({ x: X, y: Y, color });
	}
});
delete image; // don't need anymore
if (argv.random) {
	for (let i = pixels.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		const t = pixels[i];
		pixels[i] = pixels[j];
		pixels[j] = t;
	}
}
if (argv.reverse) pixels.reverse(); // reverse array
for (let i = 0; i < pixels.length; ++i) {
	while (true) {
		await drawPixel(pixels[i]);
		if (argv.debug) break;
		break;
	}
}
console.log();
return 0;
})().then(e => process.exit(e || 0));
