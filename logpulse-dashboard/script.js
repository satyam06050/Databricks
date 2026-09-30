"use strict";

const formatNumber = new Intl.NumberFormat("en-US");
const formatPercent = (value, digits = 2) => `${(Number.isFinite(value) ? value * 100 : 0).toFixed(digits)}%`;
const safeNumber = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const get = (id) => document.getElementById(id);
const CLIENT_PAGE_SIZE = 12;

const state = {
	endpoints: [],
	hourly: [],
	clients: [],
	clientPage: 0,
	search: "",
	endpointFilter: "",
	sortKey: "rate5xx",
	sortDirection: -1,
};

const endpointSortValues = {
	endpoint: (item) => item.endpoint,
	requests: (item) => item.requests,
	errors5xx: (item) => item.errors5xx,
	rate5xx: (item) => item.rate5xx,
	errors4xx: (item) => item.errors4xx,
};

function summarizeData(data) {
	if (!data || !Array.isArray(data.endpoint_hour) || !Array.isArray(data.client_ip)) {
		throw new Error("The JSON must include endpoint_hour and client_ip arrays.");
	}

	const endpointMap = new Map();
	const hourMap = new Map();
	let totalRequests = 0;
	let totalErrors5xx = 0;
	let totalErrors4xx = 0;

	data.endpoint_hour.forEach((row) => {
		if (!row || typeof row.endpoint !== "string" || typeof row.hour_ts !== "string") return;
		const requests = Math.max(0, safeNumber(row.requests));
		const errors5xx = Math.max(0, safeNumber(row.errors_5xx));
		const errors4xx = Math.max(0, safeNumber(row.errors_4xx));
		const distinctIps = Math.max(0, safeNumber(row.distinct_ips));
		totalRequests += requests;
		totalErrors5xx += errors5xx;
		totalErrors4xx += errors4xx;

		if (!endpointMap.has(row.endpoint)) {
			endpointMap.set(row.endpoint, { endpoint: row.endpoint, requests: 0, errors5xx: 0, errors4xx: 0, peakIps: 0 });
		}
		const endpoint = endpointMap.get(row.endpoint);
		endpoint.requests += requests;
		endpoint.errors5xx += errors5xx;
		endpoint.errors4xx += errors4xx;
		endpoint.peakIps = Math.max(endpoint.peakIps, distinctIps);

		if (!hourMap.has(row.hour_ts)) hourMap.set(row.hour_ts, { hour: row.hour_ts, requests: 0, errors5xx: 0 });
		const hour = hourMap.get(row.hour_ts);
		hour.requests += requests;
		hour.errors5xx += errors5xx;
	});

	const endpoints = [...endpointMap.values()].map((item) => ({
		...item,
		rate5xx: item.requests ? item.errors5xx / item.requests : 0,
	}));
	const hourly = [...hourMap.values()].sort((a, b) => a.hour.localeCompare(b.hour)).map((item) => ({
		...item,
		rate: item.requests ? item.errors5xx / item.requests : 0,
	}));
	const clients = data.client_ip.filter((client) => client && typeof client.ip === "string").map((client) => ({
		ip: client.ip,
		requests: Math.max(0, safeNumber(client.requests)),
		endpoints: Array.isArray(client.endpoints_hit) ? client.endpoints_hit.length : Math.max(0, safeNumber(client.endpoints_hit)),
		firstSeen: typeof client.first_seen === "string" ? client.first_seen : "—",
		lastSeen: typeof client.last_seen === "string" ? client.last_seen : "—",
	})).sort((a, b) => b.requests - a.requests || a.ip.localeCompare(b.ip));

	return { endpoints, hourly, clients, totalRequests, totalErrors5xx, totalErrors4xx };
}

function fillKpis(summary) {
	const { totalRequests, totalErrors5xx, endpoints, clients } = summary;
	const top50Requests = clients.slice(0, 50).reduce((total, client) => total + client.requests, 0);
	const top50Share = totalRequests ? top50Requests / totalRequests : 0;
	get("kpi-requests").textContent = formatNumber.format(totalRequests);
	get("kpi-errors").textContent = formatNumber.format(totalErrors5xx);
	get("kpi-error-rate").textContent = formatPercent(totalRequests ? totalErrors5xx / totalRequests : 0);
	get("kpi-endpoints").textContent = formatNumber.format(endpoints.length);
	get("kpi-clients").textContent = formatNumber.format(clients.length);
	get("kpi-share").textContent = formatPercent(top50Share);
	get("overall-error-rate").textContent = formatPercent(totalRequests ? totalErrors5xx / totalRequests : 0);
	get("top-client-share").textContent = formatPercent(top50Share);
	get("finding-share").textContent = `${formatPercent(top50Share)} of requests`;
}

function initializeEndpointFilter(endpoints) {
	const filter = get("endpoint-filter");
	endpoints.map((item) => item.endpoint).sort().forEach((endpoint) => {
		const option = document.createElement("option");
		option.value = endpoint;
		option.textContent = endpoint;
		filter.append(option);
	});
}

function renderEndpointTable() {
	const query = state.search.trim().toLowerCase();
	const filtered = state.endpoints.filter((item) => {
		const matchesSearch = !query || item.endpoint.toLowerCase().includes(query);
		const matchesFilter = !state.endpointFilter || item.endpoint === state.endpointFilter;
		return matchesSearch && matchesFilter;
	});
	const sortValue = endpointSortValues[state.sortKey];
	filtered.sort((a, b) => {
		const left = sortValue(a);
		const right = sortValue(b);
		const compare = typeof left === "string" ? left.localeCompare(right) : left - right;
		return compare * state.sortDirection;
	});

	const body = get("endpoint-rows");
	body.replaceChildren(...filtered.map((item) => {
		const row = document.createElement("tr");
		const isHigh = item.rate5xx >= 0.03;
		row.innerHTML = `<td class="endpoint-name"></td><td class="numeric-cell"></td><td class="numeric-cell"></td><td class="numeric-cell rate-cell"></td><td class="numeric-cell"></td><td class="numeric-cell"></td>`;
		row.cells[0].textContent = item.endpoint;
		row.cells[1].textContent = formatNumber.format(item.requests);
		row.cells[2].textContent = formatNumber.format(item.errors5xx);
		row.cells[3].innerHTML = `<span class="rate-pill ${isHigh ? "rate-pill-high rate-high" : "rate-pill-normal rate-normal"}">${formatPercent(item.rate5xx)}</span>`;
		row.cells[4].textContent = formatNumber.format(item.errors4xx);
		row.cells[5].textContent = formatNumber.format(item.peakIps);
		return row;
	}));

	get("endpoint-count").textContent = `${formatNumber.format(filtered.length)} ${filtered.length === 1 ? "endpoint" : "endpoints"}`;
	get("endpoint-empty").hidden = filtered.length > 0;
	document.querySelectorAll(".sort-button").forEach((button) => {
		const active = button.dataset.sort === state.sortKey;
		button.classList.toggle("active", active);
		button.setAttribute("aria-sort", active ? (state.sortDirection === -1 ? "descending" : "ascending") : "none");
		button.querySelector(".sort-mark").textContent = active ? (state.sortDirection === -1 ? "↓" : "↑") : "";
	});
	get("reset-filters").disabled = !state.search && !state.endpointFilter;
}

function clientDisplayTime(value) {
	if (value === "—") return value;
	const normalized = value.replace("T", " ").replace(/\.\d+Z?$/, "").replace(/Z$/, "");
	return normalized.length > 16 ? normalized.slice(0, 16) : normalized;
}

function renderClientTable() {
	const start = state.clientPage * CLIENT_PAGE_SIZE;
	const visibleClients = state.clients.slice(start, start + CLIENT_PAGE_SIZE);
	const totalRequests = state.clients.reduce((total, client) => total + client.requests, 0);
	const body = get("client-rows");

	body.replaceChildren(...visibleClients.map((client, index) => {
		const row = document.createElement("tr");
		const isTop = start + index < 50;
		row.className = isTop ? "top-client-row" : "";
		row.innerHTML = "<td class=\"client-ip\"></td><td class=\"numeric-cell\"></td><td class=\"numeric-cell\"></td><td class=\"numeric-cell\"></td><td class=\"numeric-cell\"></td><td class=\"numeric-cell\"></td>";
		row.cells[0].textContent = client.ip;
		if (isTop) {
			const tag = document.createElement("span");
			tag.className = "top-tag";
			tag.textContent = "TOP 1%";
			row.cells[0].append(tag);
		}
		row.cells[1].textContent = formatNumber.format(client.requests);
		row.cells[2].textContent = formatPercent(totalRequests ? client.requests / totalRequests : 0);
		row.cells[3].textContent = formatNumber.format(client.endpoints);
		row.cells[4].textContent = clientDisplayTime(client.firstSeen);
		row.cells[5].textContent = clientDisplayTime(client.lastSeen);
		return row;
	}));

	const end = Math.min(start + CLIENT_PAGE_SIZE, state.clients.length);
	get("client-page-label").textContent = state.clients.length ? `${formatNumber.format(start + 1)}–${formatNumber.format(end)} of ${formatNumber.format(state.clients.length)} clients` : "No clients";
	get("client-prev").disabled = state.clientPage === 0;
	get("client-next").disabled = end >= state.clients.length;
}

function prepareCanvas(canvas) {
	const rect = canvas.getBoundingClientRect();
	const ratio = Math.max(1, window.devicePixelRatio || 1);
	canvas.width = Math.round(rect.width * ratio);
	canvas.height = Math.round(rect.height * ratio);
	const context = canvas.getContext("2d");
	context.setTransform(ratio, 0, 0, ratio, 0, 0);
	return { context, width: rect.width, height: rect.height };
}

function drawErrorChart(hourly) {
	const canvas = get("error-chart");
	const { context: ctx, width, height } = prepareCanvas(canvas);
	if (!width || !height || !hourly.length) return;
	const pad = { top: 15, right: 9, bottom: 15, left: 40 };
	const plotWidth = width - pad.left - pad.right;
	const plotHeight = height - pad.top - pad.bottom;
	const maxRate = Math.max(0.02, ...hourly.map((item) => item.rate));
	const scaleMax = Math.ceil(maxRate * 100 / 2) * 2 / 100 || 0.02;
	const xAt = (index) => pad.left + (hourly.length > 1 ? index / (hourly.length - 1) : 0) * plotWidth;
	const yAt = (rate) => pad.top + plotHeight - (rate / scaleMax) * plotHeight;

	ctx.clearRect(0, 0, width, height);
	ctx.font = "9px 'DM Mono', monospace";
	ctx.textAlign = "right";
	for (let tick = 0; tick <= 4; tick += 1) {
		const value = scaleMax * tick / 4;
		const y = yAt(value);
		ctx.strokeStyle = "#eeeae6";
		ctx.lineWidth = 1;
		ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(width - pad.right, y); ctx.stroke();
		ctx.fillStyle = "#939097";
		ctx.fillText(`${(value * 100).toFixed(value * 100 < 1 ? 1 : 0)}%`, pad.left - 8, y + 3);
	}

	const gradient = ctx.createLinearGradient(0, pad.top, 0, height - pad.bottom);
	gradient.addColorStop(0, "rgba(126, 82, 129, .17)");
	gradient.addColorStop(1, "rgba(126, 82, 129, 0)");
	ctx.beginPath();
	hourly.forEach((item, index) => index ? ctx.lineTo(xAt(index), yAt(item.rate)) : ctx.moveTo(xAt(index), yAt(item.rate)));
	ctx.lineTo(xAt(hourly.length - 1), height - pad.bottom);
	ctx.lineTo(xAt(0), height - pad.bottom);
	ctx.closePath(); ctx.fillStyle = gradient; ctx.fill();

	ctx.beginPath();
	hourly.forEach((item, index) => index ? ctx.lineTo(xAt(index), yAt(item.rate)) : ctx.moveTo(xAt(index), yAt(item.rate)));
	ctx.strokeStyle = "#7e5281"; ctx.lineWidth = 1.8; ctx.lineJoin = "round"; ctx.stroke();

	hourly.forEach((item, index) => {
		if (item.rate < 0.03 && !item.hour.startsWith("2025-03-14 09") && !item.hour.startsWith("2025-03-20 16")) return;
		ctx.beginPath(); ctx.arc(xAt(index), yAt(item.rate), 3, 0, Math.PI * 2);
		ctx.fillStyle = "#b45353"; ctx.fill();
	});
	canvas._chartData = { points: hourly, xAt, yAt, pad };
}

function drawVolumeChart(endpoints) {
	const canvas = get("volume-chart");
	const { context: ctx, width, height } = prepareCanvas(canvas);
	if (!width || !height || !endpoints.length) return;
	const pad = { top: 11, right: 10, bottom: 34, left: 54 };
	const plotWidth = width - pad.left - pad.right;
	const plotHeight = height - pad.top - pad.bottom;
	const values = [...endpoints].sort((a, b) => b.requests - a.requests);
	const maxRequests = Math.max(1, ...values.map((item) => item.requests));
	const step = plotWidth / values.length;
	const barWidth = Math.min(30, step * 0.52);

	ctx.clearRect(0, 0, width, height);
	ctx.font = "9px 'DM Mono', monospace";
	ctx.textAlign = "right";
	for (let tick = 0; tick <= 4; tick += 1) {
		const value = maxRequests * tick / 4;
		const y = pad.top + plotHeight - tick / 4 * plotHeight;
		ctx.strokeStyle = "#eeeae6"; ctx.lineWidth = 1;
		ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(width - pad.right, y); ctx.stroke();
		ctx.fillStyle = "#939097"; ctx.fillText(formatCompact(value), pad.left - 8, y + 3);
	}

	values.forEach((item, index) => {
		const x = pad.left + step * index + (step - barWidth) / 2;
		const barHeight = item.requests / maxRequests * plotHeight;
		ctx.fillStyle = index === 0 ? "#7e5281" : "#b99cbb";
		roundRect(ctx, x, pad.top + plotHeight - barHeight, barWidth, barHeight, 3);
		ctx.fill();
		ctx.save();
		ctx.translate(x + barWidth / 2, height - 7);
		ctx.rotate(-Math.PI / 4);
		ctx.textAlign = "right";
		ctx.fillStyle = "#77747b";
		ctx.font = "8px 'DM Mono', monospace";
		ctx.fillText(item.endpoint, 0, 0);
		ctx.restore();
	});
	canvas._chartData = { points: values, pad, plotWidth, plotHeight, step, maxRequests, barWidth };
}

function formatCompact(value) {
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
	if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
	return formatNumber.format(Math.round(value));
}

function roundRect(ctx, x, y, width, height, radius) {
	const r = Math.min(radius, width / 2, height / 2);
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.arcTo(x + width, y, x + width, y + height, r);
	ctx.arcTo(x + width, y + height, x, y + height, r);
	ctx.arcTo(x, y + height, x, y, r);
	ctx.arcTo(x, y, x + width, y, r);
	ctx.closePath();
}

function attachChartTooltip(canvasId, tooltipId, kind) {
	const canvas = get(canvasId);
	const tooltip = get(tooltipId);
	canvas.addEventListener("pointermove", (event) => {
		const chart = canvas._chartData;
		if (!chart || !chart.points.length) return;
		const rect = canvas.getBoundingClientRect();
		const x = event.clientX - rect.left;
		let item;
		let anchorX = x;
		if (kind === "error") {
			const index = Math.max(0, Math.min(chart.points.length - 1, Math.round((x - chart.pad.left) / (rect.width - chart.pad.left - chart.pad.right) * (chart.points.length - 1))));
			item = chart.points[index];
			anchorX = chart.xAt(index);
			tooltip.innerHTML = `<strong>${item.hour}</strong><span>Requests <b>${formatNumber.format(item.requests)}</b></span><span>5xx errors <b>${formatNumber.format(item.errors5xx)}</b></span><span>Error rate <b>${formatPercent(item.rate)}</b></span>`;
		} else {
			const localX = x - chart.pad.left;
			const index = Math.max(0, Math.min(chart.points.length - 1, Math.floor(localX / chart.step)));
			item = chart.points[index];
			anchorX = chart.pad.left + index * chart.step + chart.step / 2;
			tooltip.innerHTML = `<strong>${item.endpoint}</strong><span>Requests <b>${formatNumber.format(item.requests)}</b></span><span>5xx errors <b>${formatNumber.format(item.errors5xx)}</b></span><span>5xx rate <b>${formatPercent(item.rate5xx)}</b></span>`;
		}
		tooltip.style.display = "block";
		const tooltipWidth = tooltip.offsetWidth;
		tooltip.style.left = `${Math.max(4, Math.min(rect.width - tooltipWidth - 4, anchorX + 12))}px`;
		tooltip.style.top = "10px";
	});
	canvas.addEventListener("pointerleave", () => { tooltip.style.display = "none"; });
	canvas.addEventListener("focus", () => { tooltip.style.display = "none"; });
}

function drawCharts() {
	drawErrorChart(state.hourly);
	drawVolumeChart(state.endpoints);
}

function wireControls() {
	get("endpoint-search").addEventListener("input", (event) => {
		state.search = event.target.value;
		renderEndpointTable();
	});
	get("endpoint-filter").addEventListener("change", (event) => {
		state.endpointFilter = event.target.value;
		renderEndpointTable();
	});
	get("reset-filters").addEventListener("click", () => {
		state.search = "";
		state.endpointFilter = "";
		get("endpoint-search").value = "";
		get("endpoint-filter").value = "";
		renderEndpointTable();
	});
	document.querySelectorAll(".sort-button").forEach((button) => {
		button.addEventListener("click", () => {
			const key = button.dataset.sort;
			state.sortDirection = state.sortKey === key ? state.sortDirection * -1 : (key === "endpoint" ? 1 : -1);
			state.sortKey = key;
			renderEndpointTable();
		});
	});
	get("client-prev").addEventListener("click", () => {
		state.clientPage = Math.max(0, state.clientPage - 1);
		renderClientTable();
	});
	get("client-next").addEventListener("click", () => {
		state.clientPage = Math.min(Math.ceil(state.clients.length / CLIENT_PAGE_SIZE) - 1, state.clientPage + 1);
		renderClientTable();
	});
	attachChartTooltip("error-chart", "error-tooltip", "error");
	attachChartTooltip("volume-chart", "volume-tooltip", "volume");
	let resizeFrame = 0;
	window.addEventListener("resize", () => {
		window.cancelAnimationFrame(resizeFrame);
		resizeFrame = window.requestAnimationFrame(drawCharts);
	});
}

async function loadDashboard() {
	try {
		const response = await fetch("./logpulse_data.json");
		if (!response.ok) throw new Error(`Request failed with status ${response.status}.`);
		const source = await response.json();
		const summary = summarizeData(source);
		state.endpoints = summary.endpoints;
		state.hourly = summary.hourly;
		state.clients = summary.clients;

		fillKpis(summary);
		initializeEndpointFilter(state.endpoints);
		renderEndpointTable();
		renderClientTable();
		get("loading-state").hidden = true;
		get("dashboard-content").hidden = false;
		wireControls();
		requestAnimationFrame(drawCharts);
	} catch (error) {
		get("loading-state").hidden = true;
		get("error-message").textContent = error instanceof Error ? `${error.message} Serve this folder over HTTP to enable fetch.` : "Check that logpulse_data.json is available from this page.";
		get("error-state").hidden = false;
		console.error("LogPulse data load failed:", error);
	}
}

loadDashboard();
