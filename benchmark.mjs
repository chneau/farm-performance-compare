import { spawn } from "node:child_process";
import { appendFile, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
	Logger as DefaultLogger,
	cyan,
	green,
	magenta,
	purple,
} from "@farmfe/core";
import puppeteer from "puppeteer";
import stripAnsi from "strip-ansi";
import kill from "tree-kill";
import pkg from "./package.json" with { type: "json" };
import { deleteCacheFiles, getChartPic, mergeAllVersions } from "./utils.mjs";

const startConsole = "console.log('Start Time', Date.now());";
// const startConsoleRegex = /Start Time (\d+)/;
const logger = new DefaultLogger({ name: "Benchmark" });

const farmVersion = pkg.devDependencies["@farmfe/core"].replace("^", "");
const rsbuildVersion = pkg.devDependencies["@rsbuild/core"].replace("^", "");
const viteVersion = pkg.devDependencies.vite.replace("^", "");
const webpackVersion = pkg.devDependencies.webpack.replace("^", "");

const brandColor = new Map([
	[`Farm ${farmVersion}`, purple],
	[`Farm ${farmVersion} (Hot)`, purple],
	[`RsBuild ${rsbuildVersion}`, green],
	[`RsBuild ${rsbuildVersion} (Hot)`, green],
	[`Vite ${viteVersion}`, magenta],
	[`Vite ${viteVersion} (Hot)`, magenta],
	[`Webpack ${webpackVersion}`, cyan],
	[`Webpack ${webpackVersion} (Hot)`, cyan],
]);

class BuildTool {
	constructor(
		name,
		port,
		script,
		startedRegex,
		buildScript,
		buildRegex,
		binFilePath,
		skipHmr = false,
	) {
		this.name = name;
		this.port = port;
		this.script = script;
		this.startedRegex = startedRegex;
		this.buildScript = buildScript;
		this.buildRegex = buildRegex;
		this.skipHmr = skipHmr;
		this.binFilePath = path.join(process.cwd(), "node_modules", binFilePath);
		logger.info(`hack bin file for ${this.name} under ${this.binFilePath}`, {
			name: this.name,
			brandColor: brandColor.get(this.name),
		});
		this.hackBinFile();
	}

	// Add a `console.log('Farm start', Date.now())` to the bin file's second line
	hackBinFile() {
		const binFileContent = readFileSync(this.binFilePath, "utf-8");

		if (!binFileContent.includes(startConsole)) {
			const lines = binFileContent.split("\n");
			lines.splice(1, 0, startConsole);
			writeFileSync(this.binFilePath, lines.join("\n"));
		}
	}

	async startServer() {
		return new Promise((resolve, reject) => {
			const child = spawn("npm", ["run", this.script], {
				stdio: "pipe",
				shell: true,
			});
			this.child = child;

			child.stdout.on("data", (data) => {
				const match = this.startedRegex.exec(stripAnsi(data.toString("utf8")));
				if (match) {
					let result;
					if (typeof match[1] === "number") {
						result = match[1];
					} else if (typeof match[1] === "string") {
						result = Number.parseFloat(match[1].replace(/[a-zA-Z ]/g, ""));
					}
					resolve(match[2] === "s" ? result * 1000 : result);
				}
			});
			child.on("error", (error) => {
				logger.error(`error: ${error.message}`);
				reject(error);
			});
			child.on("exit", (code) => {
				if (code !== 0 && code !== null) {
					logger.info(
						`(run ${this.script} failed) child process exited with code ${code}`,
						{
							name: this.name,
							brandColor: brandColor.get(this.name),
						},
					);
					reject(code);
				}
			});
		});
	}

	stopServer() {
		if (this.child) {
			this.child.stdin.pause();
			this.child.stdout.destroy();
			this.child.stderr.destroy();
			kill(this.child.pid);
		}
	}

	async build() {
		return new Promise((resolve) => {
			logger.info(`Running build command: ${this.buildScript}`, {
				name: this.name,
				brandColor: brandColor.get(this.name),
			});
			const child = spawn("npm", ["run", this.buildScript], {
				stdio: ["pipe"],
				shell: true,
			});
			child.stdout.on("data", (data) => {
				const match = this.buildRegex.exec(stripAnsi(data.toString("utf8")));
				if (match) {
					let result;
					if (typeof match[1] === "number") {
						result = match[1];
					} else if (typeof match[1] === "string") {
						result = Number.parseFloat(match[1].replace(/[a-zA-Z ]/g, ""));
					}
					resolve(match[2] === "s" ? result * 1000 : result);
				}
			});
			return new Promise((resolve, reject) => {
				child.on("exit", resolve);
				child.on("error", reject);
			});
		});
	}
}

const buildTools = [
	new BuildTool(
		`Farm ${farmVersion}`,
		9000,
		"start:farm",
		/Ready\s*in\s*(.+?)(m?s)/,
		"build:farm",
		/completed\s*in\s*(.+?)(m?s)/,
		"@farmfe/cli/bin/farm.mjs",
	),
	new BuildTool(
		`Farm ${farmVersion} (Hot)`,
		9000,
		"start:farm",
		/Ready\s*in\s*(.+?)(m?s)/,
		"build:farm",
		/completed\s*in\s*(.+?)(m?s)/,
		"@farmfe/cli/bin/farm.mjs",
		true,
	),
	new BuildTool(
		`Rsbuild ${rsbuildVersion}`,
		6532,
		"start:rsbuild",
		/in\s*(.+?)(m?s)/,
		"build:rsbuild",
		/in\s*(.+?)(m?s)/,
		"@rsbuild/core/bin/rsbuild.js",
	),
	new BuildTool(
		`Rsbuild ${rsbuildVersion} (Hot)`,
		6532,
		"start:rsbuild",
		/in\s*(.+?)(m?s)/,
		"build:rsbuild",
		/in\s*(.+?)(m?s)/,
		"@rsbuild/core/bin/rsbuild.js",
		true,
	),
	new BuildTool(
		`Vite ${viteVersion} (swc)`,
		5173,
		"start:vite",
		/ready\s*in\s*(.+?)(m?s)/,
		"build:vite",
		/built\s*in\s*(.+?)(m?s)/,
		"vite/bin/vite.js",
	),
	new BuildTool(
		`Vite ${viteVersion} (swc)(Hot)`,
		5173,
		"start:vite",
		/ready\s*in\s*(.+?)(m?s)/,
		"build:vite",
		/built\s*in\s*(.+?)(m?s)/,
		"vite/bin/vite.js",
		true,
	),
	new BuildTool(
		`Vite ${viteVersion} (babel)`,
		5173,
		"start:vite:babel",
		/ready\s*in\s*(.+?)(m?s)/,
		"build:vite",
		/built\s*in\s*(.+?)(m?s)/,
		"vite/bin/vite.js",
	),
	new BuildTool(
		`Vite ${viteVersion} (babel)(Hot)`,
		5173,
		"start:vite:babel",
		/ready\s*in\s*(.+?)(m?s)/,
		"build:vite",
		/built\s*in\s*(.+?)(m?s)/,
		"vite/bin/vite.js",
		true,
	),
	new BuildTool(
		`Webpack ${webpackVersion} (swc)`,
		8081,
		"start:webpack",
		/compiled\s+.+\sin\s*(.+?)(m?s)/,
		"build:webpack",
		/compiled\s+.+\sin\s*(.+?)(m?s)/,
		"webpack-cli/bin/cli.js",
	),
	new BuildTool(
		`Webpack ${webpackVersion} (swc)(Hot)`,
		8081,
		"start:webpack",
		/compiled\s+.+\sin\s*(.+?)(m?s)/,
		"build:webpack",
		/compiled\s+.+\sin\s*(.+?)(m?s)/,
		"webpack-cli/bin/cli.js",
		true,
	),
	new BuildTool(
		`Webpack ${webpackVersion} (babel)`,
		8081,
		"start:webpack:babel",
		/compiled\s+.+\sin\s*(.+?)(m?s)/,
		"build:webpack",
		/compiled\s+.+\sin\s*(.+?)(m?s)/,
		"webpack-cli/bin/cli.js",
	),
	new BuildTool(
		`Webpack ${webpackVersion} (babel)(Hot)`,
		8081,
		"start:webpack:babel",
		/compiled\s+.+\sin\s*(.+?)(m?s)/,
		"build:webpack",
		/compiled\s+.+\sin\s*(.+?)(m?s)/,
		"webpack-cli/bin/cli.js",
		true,
	),
];

const browser = await puppeteer.launch({ headless: "new" });

const n = 3;

logger.info(`Running benchmark ${n} times, please wait...`, {
	name: "Benchmark",
});

const totalResults = [];

for (let i = 0; i < n; i++) {
	// delete cache
	await deleteCacheFiles();
	await runBenchmark();
}

async function runBenchmark() {
	const results = {};

	for (const buildTool of buildTools) {
		const time = await buildTool.startServer();
		const page = await browser.newPage();
		const start = Date.now();

		page.on("load", () => {
			const loadTime = Date.now() - start;
			logger.info(`Startup time: ${time + loadTime}ms`, {
				name: buildTool.name,
				brandColor: brandColor.get(buildTool.name),
			});

			if (!results[buildTool.name]) {
				results[buildTool.name] = {};
			}

			results[buildTool.name]["startup(serverStartTime + onLoadTime)"] =
				time + loadTime;
			results[buildTool.name].serverStartTime = time;
			results[buildTool.name].onLoadTime = loadTime;
		});

		logger.info(`Navigating to http://localhost:${buildTool.port}`, {
			name: buildTool.name,
			brandColor: brandColor.get(buildTool.name),
		});

		await page.goto(`http://localhost:${buildTool.port}`, {
			timeout: 60000,
		});

		// if (!buildTool.skipHmr) {
		let waitResolve = null;
		const waitPromise = new Promise((resolve) => {
			waitResolve = resolve;
		});

		let hmrRootStart = -1;
		let hmrLeafStart = -1;

		page.on("console", (event) => {
			const isFinished = () => {
				return (
					results[buildTool.name]?.rootHmr && results[buildTool.name]?.leafHmr
				);
			};
			if (event.text().includes("root hmr")) {
				const clientDateNow = /(\d+)/.exec(event.text())[1];
				const hmrTime = clientDateNow - hmrRootStart;
				logger.info(`Root HMR time: ${hmrTime}ms`, {
					name: buildTool.name,
					brandColor: brandColor.get(buildTool.name),
				});

				results[buildTool.name].rootHmr = hmrTime;
				if (isFinished()) {
					page.close();
					waitResolve();
				}
			} else if (event.text().includes("leaf hmr")) {
				const hmrTime = Date.now() - hmrLeafStart;
				logger.info(`Leaf HMR time: ${hmrTime}ms`, {
					name: buildTool.name,
					brandColor: brandColor.get(buildTool.name),
				});
				results[buildTool.name].leafHmr = hmrTime;
				if (isFinished()) {
					page.close();
					waitResolve();
				}
			}
		});

		await new Promise((resolve) => setTimeout(resolve, 1000));
		const originalRootFileContent = readFileSync(
			path.resolve("src", "comps", "triangle.jsx"),
			"utf-8",
		);

		appendFile(
			path.resolve("src", "comps", "triangle.jsx"),
			`
      console.log('root hmr', Date.now());
      `,
			(err) => {
				if (err) throw err;
				hmrRootStart = Date.now();
			},
		);

		await new Promise((resolve) => setTimeout(resolve, 1000));

		const originalLeafFileContent = readFileSync(
			path.resolve("src", "comps", "triangle_1_1_2_1_2_2_1.jsx"),
			"utf-8",
		);
		appendFile(
			path.resolve("src", "comps", "triangle_1_1_2_1_2_2_1.jsx"),
			`
        console.log('leaf hmr', Date.now());
        `,
			(err) => {
				if (err) throw err;
				hmrLeafStart = Date.now();
			},
		);

		await waitPromise;

		// restore files
		writeFileSync(
			path.resolve("src", "comps", "triangle.jsx"),
			originalRootFileContent,
		);
		writeFileSync(
			path.resolve("src", "comps", "triangle_1_1_2_1_2_2_1.jsx"),
			originalLeafFileContent,
		);

		buildTool.stopServer();
		// } else {
		//   logger.warn("The Second BuildTools Skip HMR");
		// }

		await new Promise((resolve) => setTimeout(resolve, 500));
		logger.info("close Server", {
			brandColor: brandColor.get(buildTool.name),
		});
		logger.info("prepare build", {
			brandColor: brandColor.get(buildTool.name),
		});
		const buildTime = await buildTool.build();
		logger.info(`: build time: ${buildTime}ms`, {
			name: buildTool.name,
			brandColor: brandColor.get(buildTool.name),
		});
		results[buildTool.name].buildTime = buildTime;
		await new Promise((resolve) => setTimeout(resolve, 500));
	}

	totalResults.push(results);
}

const averageResults = {};
const chart = {};
const chartData = {};
for (const result of totalResults) {
	for (const [name, values] of Object.entries(result)) {
		if (!averageResults[name]) {
			averageResults[name] = {};
		}

		if (!chartData[name]) {
			chartData[name] = {};
		}

		if (!chart[name]) {
			chart[name] = {};
		}

		for (const [key, value] of Object.entries(values)) {
			if (!averageResults[name][key]) {
				averageResults[name][key] = "Calculation error Time ！";
			}

			if (!chartData[name][key]) {
				chartData[name][key] = 0;
				chart[name][key] = 0;
			}

			chartData[name][key] += Number(value);
			averageResults[name][key] = `${Math.floor(
				chartData[name][key] / totalResults.length,
			)}ms`;
			chart[name][key] = Math.floor(chartData[name][key] / totalResults.length);
		}
	}
}

mergeAllVersions(chart);

logger.info(`Average results of ${totalResults.length} runs:`, {
	name: "Benchmark",
});
const benchmarkData = { ...chart };
await getChartPic(benchmarkData);
console.table(averageResults);

process.exit(0);
