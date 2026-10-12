"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { createClient } from "@supabase/supabase-js";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ReferenceArea, ReferenceDot, ResponsiveContainer
} from "recharts";
import {
  format,
    subHours, subDays, subWeeks, subMonths, subYears,
    startOfHour, startOfDay, startOfWeek, startOfMonth, startOfYear
} from "date-fns";
import {
  Activity, Clock, AlertTriangle, Wifi, WifiOff,
  ShieldCheck, ShieldAlert, ThermometerSnowflake,
  MousePointerClick, XCircle, RotateCcw, Github
} from "lucide-react";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface Telemetry {
  id?: number;
  created_at: string;
  temperature: number;
  status: string;
  timeMs: number;
}

interface Incident {
  id: number;
  start_time: string;
  end_time: string | null;
  peak_temperature: number;
}

interface HighlightState {
  type: 'breach' | 'peak' | 'deep';
  data: Incident | Telemetry;
}

const calculateDuration = (start: string, end: string | null) => {
  if (!end) return "--";
  const totalSeconds = Math.floor((new Date(end).getTime() - new Date(start).getTime()) / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const parts = [];
  if (h > 0) parts.push(`${h} hr`);
  if (m > 0) parts.push(`${m} min`);
  if (s > 0 || parts.length === 0) parts.push(`${s} sec`);
  return parts.join(' ');
};

export default function Dashboard() {
  const chartRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const [telemetry, setTelemetry] = useState<Telemetry[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [latest, setLatest] = useState<Telemetry | null>(null);
  const [isOffline, setIsOffline] = useState(true);

  const [timeRange, setTimeRange] = useState("1mo");
  const [timeMode, setTimeMode] = useState<"rolling" | "absolute">("rolling");
  const [isHistorical, setIsHistorical] = useState(false);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  const [activeHighlight, setActiveHighlight] = useState<HighlightState | null>(null);

  const handleHighlight = (type: 'breach' | 'peak' | 'deep', data: Incident | Telemetry) => {
    setActiveHighlight({ type, data });
    setTimeout(() => {
      chartRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
  };

  useEffect(() => {
    if (activeHighlight && scrollContainerRef.current && telemetry.length > 0) {
      const container = scrollContainerRef.current;
      const minTime = telemetry[0].timeMs;
      const maxTime = telemetry[telemetry.length - 1].timeMs;

      const targetTime = activeHighlight.type === 'breach'
  ? new Date((activeHighlight.data as Incident).start_time).getTime()
  : (activeHighlight.data as Telemetry).timeMs;

  const timeout = setTimeout(() => {
    if (targetTime >= minTime && targetTime <= maxTime) {
      const ratio = (targetTime - minTime) / (maxTime - minTime);
      const maxScroll = container.scrollWidth - container.clientWidth;
      if (maxScroll > 0) {
        container.scrollTo({ left: maxScroll * ratio, behavior: 'smooth' });
      }
    }
  }, 100);

  return () => clearTimeout(timeout);
    }
  }, [telemetry, activeHighlight]);

  const resetToDefault = () => {
    setTimeRange("1mo");
    setTimeMode("rolling");
    setIsHistorical(false);
    setCustomStart("");
    setCustomEnd("");
    setActiveHighlight(null);
  };

  const getBounds = useCallback(() => {
    const now = new Date();
    let start = new Date();
    const end = now;

    if (isHistorical && customStart && customEnd) {
      return { start: new Date(customStart), end: new Date(customEnd) };
    }

    if (timeMode === "rolling") {
      switch(timeRange) {
        case "1h": start = subHours(now, 1); break;
        case "3h": start = subHours(now, 3); break;
        case "6h": start = subHours(now, 6); break;
        case "12h": start = subHours(now, 12); break;
        case "1d": start = subHours(now, 24); break;
        case "1w": start = subWeeks(now, 1); break;
        case "2w": start = subWeeks(now, 2); break;
        case "1mo": start = subMonths(now, 1); break;
        case "3mo": start = subMonths(now, 3); break;
        case "6mo": start = subMonths(now, 6); break;
        case "1y": start = subYears(now, 1); break;
      }
    } else {
      switch(timeRange) {
        case "1h": start = startOfHour(now); break;
        case "3h": start = subHours(startOfHour(now), 3); break;
        case "6h": start = subHours(startOfHour(now), 6); break;
        case "12h": start = subHours(startOfHour(now), 12); break;
        case "1d": start = startOfDay(now); break;
        case "1w": start = startOfWeek(now); break;
        case "2w": start = subWeeks(startOfWeek(now), 1); break;
        case "1mo": start = startOfMonth(now); break;
        case "3mo": start = subMonths(startOfMonth(now), 2); break;
        case "6mo": start = subMonths(startOfMonth(now), 5); break;
        case "1y": start = startOfYear(now); break;
      }
    }
    return { start, end };
  }, [timeRange, timeMode, isHistorical, customStart, customEnd]);

  useEffect(() => {
    document.title = "Freeze Pharm";

    const fetchLatest = async () => {
      const { data } = await supabase.from("telemetry").select("*").order("created_at", { ascending: false }).limit(1);
      if (data && data.length > 0) {
        const latestData = { ...data[0], timeMs: new Date(String(data[0].created_at)).getTime() };
        setLatest(latestData);
        setIsOffline(new Date().getTime() - latestData.timeMs > 210000);
      }
    };

    const fetchFilteredData = async () => {
      const { start, end } = getBounds();

      let allTData: Telemetry[] = [];
      let from = 0;
      const step = 999;
      let keepFetching = true;

      while (keepFetching) {
        const { data: tData } = await supabase
        .from("telemetry")
        .select("*")
        .gte("created_at", start.toISOString())
        .lte("created_at", end.toISOString())
        .order("created_at", { ascending: false })
        .range(from, from + step);

        if (tData && tData.length > 0) {
          allTData = [...allTData, ...tData];
          from += (step + 1);
          if (tData.length <= step || allTData.length >= 100000) {
            keepFetching = false;
          }
        } else {
          keepFetching = false;
        }
      }

      const { data: iData } = await supabase
      .from("incidents")
      .select("*")
      .gte("start_time", start.toISOString())
      .lte("start_time", end.toISOString())
      .order("start_time", { ascending: false });

      if (allTData.length > 0) {
        const formatted = allTData.reverse().map(d => ({
          ...d,
          timeMs: new Date(String(d.created_at)).getTime()
        }));
        setTelemetry(formatted);
      } else {
        setTelemetry([]);
      }

      if (iData) setIncidents(iData);
    };

      fetchLatest();
      fetchFilteredData();

      const latestInterval = setInterval(fetchLatest, 5000);
      const filterInterval = setInterval(fetchFilteredData, 10000);
      return () => { clearInterval(latestInterval); clearInterval(filterInterval); };
  }, [getBounds]);

  const { healthScore, avgTemp, maxTemp, minTemp, maxPoint, minPoint } = useMemo<{
    healthScore: number;
    avgTemp: string;
    maxTemp: string;
    minTemp: string;
    maxPoint: Telemetry | null;
    minPoint: Telemetry | null;
  }>(() => {
    let score = 100;

    // LENIENT PENALTY LOGIC
    incidents.forEach(inc => {
      score -= 3; // Reduced flat penalty per incident
      const startMs = new Date(inc.start_time).getTime();
      const endMs = inc.end_time ? new Date(inc.end_time).getTime() : new Date().getTime();
      // Reduced duration penalty to 0.5 points per hour
      score -= ((endMs - startMs) / 3600000) * 0.5;
    });

    let sum = 0, max = -999, min = 999;
    let maxPt: Telemetry | null = null, minPt: Telemetry | null = null;

    telemetry.forEach(d => {
      sum += d.temperature;
      if (d.temperature > max) { max = d.temperature; maxPt = d; }
      if (d.temperature < min) { min = d.temperature; minPt = d; }
    });

    return {
      healthScore: Math.max(0, Math.round(score)),
     avgTemp: telemetry.length ? (sum / telemetry.length).toFixed(2) : "--",
     maxTemp: max !== -999 ? max.toFixed(2) : "--",
     minTemp: min !== 999 ? min.toFixed(2) : "--",
     maxPoint: maxPt,
     minPoint: minPt
    };
  }, [telemetry, incidents]);

  const downsampledTelemetry = useMemo(() => {
    if (telemetry.length <= 300) return telemetry;
    const step = Math.ceil(telemetry.length / 300);
    const resultMap = new Map<number, Telemetry>();

    telemetry.forEach((d, i) => {
      if (i % step === 0 || d.status === 'BREACH' || d.status === 'WARNING') {
        resultMap.set(d.timeMs, d);
      }
    });

    if (maxPoint) resultMap.set(maxPoint.timeMs, maxPoint);
    if (minPoint) resultMap.set(minPoint.timeMs, minPoint);

    return Array.from(resultMap.values()).sort((a, b) => a.timeMs - b.timeMs);
  }, [telemetry, maxPoint, minPoint]);

  const getStatusColor = (status: string | undefined, offline: boolean) => {
    if (offline) return "bg-slate-700";
    if (status === "BREACH") return "bg-red-700 animate-pulse";
    if (status === "WARNING") return "bg-yellow-600";
    return "bg-emerald-700";
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 sm:p-6 font-sans flex flex-col">
    <div className="max-w-7xl mx-auto space-y-6 flex-grow w-full">

    {/* Persistent Header */}
    <div className={`sticky top-0 sm:top-2 z-50 p-5 rounded-xl flex items-center justify-between ${getStatusColor(latest?.status, isOffline)} transition-colors duration-500 shadow-2xl border border-white/20 -mx-2 sm:mx-0 backdrop-blur-md`}>
    <div>
    <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white drop-shadow-md">Freeze Pharm</h1>
    <p className="text-white/90 font-semibold text-sm sm:text-base mt-1">
    {isOffline ? "SYSTEM OFFLINE - WATCHDOG TRIGGERED" : `SYSTEM STATUS: ${latest?.status || "INITIALIZING"}`}
    </p>
    </div>
    {isOffline ? <WifiOff size={32} className="text-white shrink-0 ml-4 opacity-80" /> : <Wifi size={32} className="text-white shrink-0 ml-4" />}
    </div>

    {/* Top KPI Cards (Adjusted to 3 columns) */}
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6 mt-4">
    <div className="bg-slate-900 p-5 rounded-xl border border-slate-800 shadow-md relative overflow-hidden">
    <div className="flex items-center justify-between mb-2 text-slate-400">
    <span className="font-bold tracking-wider text-xs uppercase">Current Temp</span>
    <Activity size={20} className={isOffline ? "text-slate-500" : latest?.status === "BREACH" ? "text-red-500" : latest?.status === "WARNING" ? "text-yellow-500" : "text-blue-400"} />
    </div>
    <div className={`text-4xl sm:text-5xl font-black mt-2 transition-colors duration-300 ${isOffline ? "text-slate-500" : latest?.status === "BREACH" ? "text-red-500 animate-pulse" : latest?.status === "WARNING" ? "text-yellow-500" : "text-white"}`}>
    {latest ? `${latest.temperature}°C` : "--"}
    </div>
    </div>

    <div className="bg-slate-900 p-5 rounded-xl border border-slate-800 shadow-md">
    <div className="flex items-center justify-between mb-2 text-slate-400">
    <span className="font-bold tracking-wider text-xs uppercase">Management Score</span>
    {healthScore >= 80 ? <ShieldCheck size={20} className="text-green-500" /> : <ShieldAlert size={20} className="text-red-500" />}
    </div>
    <div className="flex items-baseline gap-2 mt-2">
    <span className={`text-4xl sm:text-5xl font-black ${healthScore >= 80 ? "text-green-500" : healthScore >= 50 ? "text-yellow-500" : "text-red-500"}`}>
    {healthScore}
    </span>
    <span className="text-sm font-semibold text-slate-500">/ 100</span>
    </div>
    </div>

    <div className="bg-slate-900 p-5 rounded-xl border border-slate-800 shadow-md">
    <div className="flex items-center justify-between mb-2 text-slate-400">
    <span className="font-bold tracking-wider text-xs uppercase">Last Update</span>
    <Clock size={20} />
    </div>
    <div className="text-lg font-bold mt-3 text-slate-300">
    {latest ? format(new Date(String(latest.created_at)), "MMM d, yyyy") : "--"}
    <br />
    <span className="text-2xl text-white">{latest ? format(new Date(String(latest.created_at)), "HH:mm:ss") : "--"}</span>
    </div>
    </div>
    </div>

    {/* Controls Panel */}
    <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 shadow-md flex flex-wrap gap-4 items-end">
    <div className="flex flex-col gap-1 w-full sm:w-auto">
    <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Time Range</label>
    <select
    value={timeRange}
    onChange={(e) => { setTimeRange(e.target.value); setIsHistorical(false); setActiveHighlight(null); }}
    className="bg-slate-950 border border-slate-700 text-sm rounded-lg px-3 py-2 text-white outline-none focus:border-blue-500 transition-colors w-full sm:w-auto cursor-pointer"
    disabled={isHistorical}
    >
    <option value="1h">1 Hour</option>
    <option value="3h">3 Hours</option>
    <option value="6h">6 Hours</option>
    <option value="12h">12 Hours</option>
    <option value="1d">24 Hours</option>
    <option value="1w">1 Week</option>
    <option value="2w">1 Fortnight (14d)</option>
    <option value="1mo">1 Month</option>
    <option value="3mo">3 Months</option>
    <option value="6mo">6 Months</option>
    <option value="1y">1 Year</option>
    </select>
    </div>

    <div className="flex flex-col gap-1 w-full sm:w-auto">
    <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Mode</label>
    <select
    value={timeMode}
    onChange={(e) => { setTimeMode(e.target.value as "rolling" | "absolute"); setActiveHighlight(null); }}
    className="bg-slate-950 border border-slate-700 text-sm rounded-lg px-3 py-2 text-white outline-none focus:border-blue-500 transition-colors w-full sm:w-auto cursor-pointer"
    disabled={isHistorical}
    >
    <option value="rolling">Rolling (From Now)</option>
    <option value="absolute">Absolute (Start of Period)</option>
    </select>
    </div>

    <div className="flex items-center gap-2 h-[38px] px-3 bg-slate-950 rounded-lg border border-slate-800 w-full sm:w-auto hover:bg-slate-800/50 transition-colors">
    <input
    type="checkbox"
    id="historyToggle"
    checked={isHistorical}
    onChange={(e) => { setIsHistorical(e.target.checked); setActiveHighlight(null); }}
    className="w-4 h-4 rounded bg-slate-900 border-slate-700 text-blue-500 focus:ring-blue-500 focus:ring-offset-slate-900 cursor-pointer"
    />
    <label htmlFor="historyToggle" className="text-sm font-medium text-slate-300 select-none cursor-pointer w-full">Custom History</label>
    </div>

    {isHistorical && (
      <div className="flex flex-wrap gap-3 items-end border-l-2 border-blue-500/30 pl-4 w-full lg:w-auto bg-slate-950/30 p-2 rounded-lg">
      <div className="flex flex-col gap-1 w-full sm:w-auto">
      <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Start Date & Time</label>
      <input
      type="datetime-local"
      value={customStart}
      onClick={(e) => (e.target as HTMLInputElement).showPicker && (e.target as HTMLInputElement).showPicker()}
      onChange={(e) => { setCustomStart(e.target.value); setActiveHighlight(null); }}
      className="bg-slate-950 border border-slate-700 text-sm rounded-lg px-3 py-2 text-white outline-none focus:border-blue-500 cursor-pointer w-full sm:w-auto"
      />
      </div>
      <div className="flex flex-col gap-1 w-full sm:w-auto">
      <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">End Date & Time</label>
      <input
      type="datetime-local"
      value={customEnd}
      onClick={(e) => (e.target as HTMLInputElement).showPicker && (e.target as HTMLInputElement).showPicker()}
      onChange={(e) => { setCustomEnd(e.target.value); setActiveHighlight(null); }}
      className="bg-slate-950 border border-slate-700 text-sm rounded-lg px-3 py-2 text-white outline-none focus:border-blue-500 cursor-pointer w-full sm:w-auto"
      />
      </div>
      </div>
    )}

    <div className="flex-grow"></div>

    <button
    onClick={resetToDefault}
    className="flex items-center justify-center gap-2 h-[38px] px-4 bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold rounded-lg transition-colors w-full sm:w-auto shadow-md"
    >
    <RotateCcw size={16} /> Reset Default
    </button>
    </div>

    {/* Breach Log */}
    <div className="bg-slate-900 p-5 rounded-xl border border-slate-800 shadow-md overflow-hidden">
    <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-2">
    <h2 className="text-lg font-bold flex items-center gap-2 text-red-400 uppercase tracking-wider">
    <AlertTriangle size={20} /> Period Breach Log
    </h2>
    {incidents.length > 0 && (
      <p className="text-xs font-bold text-slate-300 flex items-center gap-1.5 bg-blue-900/40 py-1.5 px-3 rounded-full border border-blue-500/30">
      <MousePointerClick size={14} className="text-blue-400" /> Click an incident to highlight & locate on graph
      </p>
    )}
    </div>

    <div className="overflow-x-auto">
    <table className="w-full text-left border-collapse whitespace-nowrap">
    <thead>
    <tr className="border-b border-slate-700 text-slate-400 text-xs font-bold tracking-widest uppercase">
    <th className="pb-3 px-4">Start Time</th>
    <th className="pb-3 px-4">End Time</th>
    <th className="pb-3 px-4">Duration</th>
    <th className="pb-3 px-4">Peak Temp</th>
    </tr>
    </thead>
    <tbody className="text-slate-200 text-sm font-medium">
    {incidents.length === 0 ? (
      <tr>
      <td colSpan={4} className="py-8 text-center text-slate-500 bg-slate-900/50">No thermal breaches in selected period.</td>
      </tr>
    ) : (
      incidents.map((inc) => (
        <tr
        key={inc.id}
        onClick={() => handleHighlight('breach', inc)}
        className={`border-b border-slate-800 cursor-pointer transition-all duration-200
          ${activeHighlight?.data && 'id' in activeHighlight.data && activeHighlight.data.id === inc.id ? "bg-red-900/30 border-l-4 border-l-red-500 shadow-inner" : "hover:bg-slate-800 hover:scale-[1.01] border-l-4 border-l-transparent"}`}
          >
          <td className="py-3 px-4">{format(new Date(String(inc.start_time)), "MMM d, HH:mm:ss")}</td>
          <td className="py-3 px-4">{inc.end_time ? format(new Date(String(inc.end_time)), "MMM d, HH:mm:ss") : <span className="text-red-500 font-bold animate-pulse">ACTIVE</span>}</td>
          <td className="py-3 px-4">{calculateDuration(inc.start_time, inc.end_time)}</td>
          <td className="py-3 px-4 font-mono text-red-400">{inc.peak_temperature}°C</td>
          </tr>
      ))
    )}
    </tbody>
    </table>
    </div>
    </div>

    {/* Temperature Graph & Stats */}
    <div ref={chartRef} className="grid grid-cols-1 lg:grid-cols-4 gap-6 scroll-mt-32">
    <div className="lg:col-span-3 bg-slate-900 p-5 rounded-xl border border-slate-800 shadow-md relative">
    <div className="flex items-center justify-between mb-6">
    <h2 className="text-lg font-bold flex items-center gap-2 uppercase tracking-wider">
    <Activity size={20} className="text-blue-500" /> Temperature Trend
    </h2>
    {activeHighlight && (
      <button
      onClick={() => setActiveHighlight(null)}
      className="flex items-center gap-1.5 text-xs font-bold text-slate-200 bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-full transition-colors border border-slate-600 shadow-md"
      >
      <XCircle size={16} className="text-red-400" /> Clear Selection
      </button>
    )}
    </div>

    <div ref={scrollContainerRef} className="w-full overflow-x-auto pb-4 scroll-smooth">
    <div className="h-[400px] min-w-[800px]">
    <ResponsiveContainer width="100%" height="100%">
    <LineChart data={downsampledTelemetry} margin={{ top: 10, right: 30, bottom: 5, left: -10 }}>
    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
    <XAxis
    dataKey="timeMs"
    type="number"
    domain={['dataMin', 'dataMax']}
    scale="time"
    stroke="#64748b"
    tickFormatter={(ms) => {
      const val = Number(ms);
      if (isNaN(val)) return "";
      const isLongPeriod = timeRange === "1w" || timeRange === "2w" || timeRange.includes("mo") || timeRange.includes("y") || (isHistorical && customStart && customEnd && new Date(customEnd).getTime() - new Date(customStart).getTime() > 172800000);
      return format(new Date(val), isLongPeriod ? "MMM d" : "HH:mm");
    }}
    tickCount={8}
    />
    <YAxis
    stroke="#64748b"
    domain={[
      (dataMin: number) => Math.min(-2, Math.floor(dataMin - 2)),
          (dataMax: number) => Math.max(12, Math.ceil(dataMax + 2))
    ]}
    />
    <Tooltip
    contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px', color: '#f8fafc', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)' }}
    labelFormatter={(label) => format(new Date(Number(label)), "PP pp")}
    />
    <ReferenceLine y={8.0} stroke="#ef4444" strokeDasharray="4 4" label={{ value: "Upper Bound (8°C)", fill: "#ef4444", position: "insideTopLeft", offset: 10 }} />
    <ReferenceLine y={2.0} stroke="#ef4444" strokeDasharray="4 4" label={{ value: "Lower Bound (2°C)", fill: "#ef4444", position: "insideBottomRight", offset: 10 }} />

    {activeHighlight?.type === 'breach' && activeHighlight.data && (
      <ReferenceArea
      x1={new Date((activeHighlight.data as Incident).start_time).getTime()}
      x2={(activeHighlight.data as Incident).end_time ? new Date((activeHighlight.data as Incident).end_time!).getTime() : new Date().getTime()}
      fill="#ef4444" fillOpacity={0.25} stroke="#ef4444" strokeOpacity={0.5}
      />
    )}
    {activeHighlight?.type === 'peak' && activeHighlight.data && (
      <>
      <ReferenceLine x={(activeHighlight.data as Telemetry).timeMs} stroke="#ef4444" strokeDasharray="3 3" />
      <ReferenceDot x={(activeHighlight.data as Telemetry).timeMs} y={(activeHighlight.data as Telemetry).temperature} r={8} fill="#ef4444" stroke="#fff" strokeWidth={2} />
      </>
    )}
    {activeHighlight?.type === 'deep' && activeHighlight.data && (
      <>
      <ReferenceLine x={(activeHighlight.data as Telemetry).timeMs} stroke="#3b82f6" strokeDasharray="3 3" />
      <ReferenceDot x={(activeHighlight.data as Telemetry).timeMs} y={(activeHighlight.data as Telemetry).temperature} r={8} fill="#3b82f6" stroke="#fff" strokeWidth={2} />
      </>
    )}

    <Line type="monotone" dataKey="temperature" stroke="#3b82f6" strokeWidth={3} dot={false} activeDot={{ r: 6, fill: "#60a5fa", strokeWidth: 0 }} />
    </LineChart>
    </ResponsiveContainer>
    </div>
    </div>
    </div>

    {/* Period Analytics Panel */}
    <div className="bg-slate-900 p-5 rounded-xl border border-slate-800 shadow-md flex flex-col gap-4">
    <h2 className="text-lg font-bold flex items-center gap-2 uppercase tracking-wider text-slate-300 mb-2">
    <ThermometerSnowflake size={20} className="text-blue-400" /> Period Analytics
    </h2>

    <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 flex flex-col gap-1">
    <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Average Temp</span>
    <span className="text-3xl font-black text-white">{avgTemp}°C</span>
    </div>

    <div
    onClick={() => { maxPoint && handleHighlight('peak', maxPoint); }}
    className={`bg-slate-950 p-4 rounded-lg border border-slate-800 flex flex-col gap-1 cursor-pointer transition-all duration-200 group
      ${activeHighlight?.type === 'peak' ? 'ring-2 ring-red-500 scale-[1.02]' : 'hover:bg-slate-800 hover:scale-[1.02]'}`}
      >
      <div className="flex justify-between items-center w-full">
      <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Peak Max</span>
      <MousePointerClick size={14} className="text-slate-600 group-hover:text-red-400 transition-colors" />
      </div>
      <span className="text-3xl font-black text-red-400">{maxTemp}°C</span>
      <span className="text-[10px] text-slate-500 hidden group-hover:block transition-all">Click to locate on graph</span>
      </div>

      <div
      onClick={() => { minPoint && handleHighlight('deep', minPoint); }}
      className={`bg-slate-950 p-4 rounded-lg border border-slate-800 flex flex-col gap-1 cursor-pointer transition-all duration-200 group
        ${activeHighlight?.type === 'deep' ? 'ring-2 ring-blue-500 scale-[1.02]' : 'hover:bg-slate-800 hover:scale-[1.02]'}`}
        >
        <div className="flex justify-between items-center w-full">
        <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Deepest Min</span>
        <MousePointerClick size={14} className="text-slate-600 group-hover:text-blue-400 transition-colors" />
        </div>
        <span className="text-3xl font-black text-blue-400">{minTemp}°C</span>
        <span className="text-[10px] text-slate-500 hidden group-hover:block transition-all">Click to locate on graph</span>
        </div>
        </div>
        </div>

        {/* Footer section added here */}
        <footer className="mt-8 pt-6 border-t border-slate-800/50 flex flex-col sm:flex-row items-center justify-between text-slate-500 text-sm">
        <p>&copy; 2026 ARTEMIS. All rights reserved.</p>
        <div className="flex items-center gap-2 mt-4 sm:mt-0">
        <span>Built by ARTEMIS</span>
        <a href="https://github.com/mtf-samee" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors" aria-label="GitHub Profile">
        <Github size={18} />
        </a>
        </div>
        </footer>

        </div>
        </div>
  );
}
