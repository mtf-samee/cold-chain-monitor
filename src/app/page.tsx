"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { createClient } from "@supabase/supabase-js";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from "recharts";
import {
  format,
    subHours, subDays, subWeeks, subMonths, subYears,
    startOfHour, startOfDay, startOfWeek, startOfMonth, startOfYear
} from "date-fns";
import {
  Activity, Clock, AlertTriangle, Wifi, WifiOff,
  Battery, BatteryMedium, BatteryLow, BatteryFull,
  ShieldCheck, ShieldAlert, ThermometerSnowflake
} from "lucide-react";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

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

const getBatteryPercentage = (voltage: number) => {
  if (!voltage) return 0;
  return Math.max(0, Math.min(100, Math.round(((voltage - 3.3) / 0.9) * 100)));
};

const downsample = (data: any[], maxPoints: number) => {
  if (data.length <= maxPoints) return data;
  const step = Math.ceil(data.length / maxPoints);
  return data.filter((_, i) => i % step === 0);
};

export default function Dashboard() {
  const [telemetry, setTelemetry] = useState<any[]>([]);
  const [incidents, setIncidents] = useState<any[]>([]);
  const [latest, setLatest] = useState<any>(null);
  const [isOffline, setIsOffline] = useState(true);

  const [timeRange, setTimeRange] = useState("1mo");
  const [timeMode, setTimeMode] = useState<"rolling" | "absolute">("rolling");
  const [isHistorical, setIsHistorical] = useState(false);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

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
        case "1d": start = subDays(now, 1); break;
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
        setLatest(data[0]);
        const lastPing = new Date(String(data[0].created_at)).getTime();
        setIsOffline(new Date().getTime() - lastPing > 210000);
      }
    };

    const fetchFilteredData = async () => {
      const { start, end } = getBounds();

      const { data: tData } = await supabase
      .from("telemetry")
      .select("*")
      .gte("created_at", start.toISOString())
      .lte("created_at", end.toISOString())
      .order("created_at", { ascending: true })
      .limit(10000);

      const { data: iData } = await supabase
      .from("incidents")
      .select("*")
      .gte("start_time", start.toISOString())
      .lte("start_time", end.toISOString())
      .order("start_time", { ascending: false });

      if (tData) {
        const formatted = tData.map(d => ({
          ...d,
          timeMs: new Date(String(d.created_at)).getTime()
        }));
        setTelemetry(formatted);
      }
      if (iData) setIncidents(iData);
    };

      fetchLatest();
      fetchFilteredData();

      const latestInterval = setInterval(fetchLatest, 10000);
      const filterInterval = setInterval(fetchFilteredData, 30000);
      return () => { clearInterval(latestInterval); clearInterval(filterInterval); };
  }, [getBounds]);

  const { healthScore, avgTemp, maxTemp, minTemp } = useMemo(() => {
    let score = 100;
    incidents.forEach(inc => {
      score -= 10;
      const startMs = new Date(inc.start_time).getTime();
      const endMs = inc.end_time ? new Date(inc.end_time).getTime() : new Date().getTime();
      const hours = (endMs - startMs) / 3600000;
      score -= (hours * 2);
    });
    const finalScore = Math.max(0, Math.round(score));

    let sum = 0, max = -999, min = 999;
    telemetry.forEach(d => {
      sum += d.temperature;
      if (d.temperature > max) max = d.temperature;
      if (d.temperature < min) min = d.temperature;
    });

      return {
        healthScore: finalScore,
        avgTemp: telemetry.length ? (sum / telemetry.length).toFixed(2) : "--",
                                                             maxTemp: max !== -999 ? max.toFixed(2) : "--",
                                                             minTemp: min !== 999 ? min.toFixed(2) : "--"
      };
  }, [telemetry, incidents]);

  const downsampledTelemetry = downsample(telemetry, 300);
  const batteryPct = latest ? getBatteryPercentage(latest.battery_voltage) : 0;

  const renderBatteryIcon = () => {
    if (isOffline || !latest) return <Battery className="text-slate-500" size={24} />;
    if (batteryPct >= 75) return <BatteryFull className="text-green-500" size={24} />;
    if (batteryPct >= 40) return <BatteryMedium className="text-yellow-500" size={24} />;
    return <BatteryLow className="text-red-500 animate-pulse" size={24} />;
  };

  const getStatusColor = (status: string, offline: boolean) => {
    if (offline) return "bg-slate-600";
    if (status === "BREACH") return "bg-red-600 animate-pulse";
    if (status === "WARNING") return "bg-yellow-600";
    return "bg-emerald-600";
  };

  const getTempValueColor = (status: string, offline: boolean) => {
    if (offline) return "text-slate-500";
    if (status === "BREACH") return "text-red-500 animate-pulse";
    if (status === "WARNING") return "text-yellow-500";
    return "text-white";
  };

  const getTempIconColor = (status: string, offline: boolean) => {
    if (offline) return "text-slate-500";
    if (status === "BREACH") return "text-red-500";
    if (status === "WARNING") return "text-yellow-500";
    return "text-blue-400";
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 sm:p-6 font-sans">
    <div className="max-w-7xl mx-auto space-y-6">

    {/* Header */}
    <div className={`p-5 rounded-xl flex items-center justify-between ${getStatusColor(latest?.status, isOffline)} transition-colors duration-500 shadow-lg border border-white/10`}>
    <div>
    <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white drop-shadow-md">Freeze Pharm</h1>
    <p className="text-white/90 font-semibold text-sm sm:text-base mt-1">
    {isOffline ? "SYSTEM OFFLINE - WATCHDOG TRIGGERED" : `SYSTEM STATUS: ${latest?.status || "INITIALIZING"}`}
    </p>
    </div>
    {isOffline ? <WifiOff size={32} className="text-white shrink-0 ml-4 opacity-80" /> : <Wifi size={32} className="text-white shrink-0 ml-4" />}
    </div>

    {/* Top KPI Cards */}
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
    <div className="bg-slate-900 p-5 rounded-xl border border-slate-800 shadow-md relative overflow-hidden">
    <div className="flex items-center justify-between mb-2 text-slate-400">
    <span className="font-bold tracking-wider text-xs uppercase">Current Temp</span>
    <Activity size={20} className={getTempIconColor(latest?.status, isOffline)} />
    </div>
    <div className={`text-4xl sm:text-5xl font-black mt-2 transition-colors duration-300 ${getTempValueColor(latest?.status, isOffline)}`}>
    {latest ? `${latest.temperature}°C` : "--"}
    </div>
    </div>

    <div className="bg-slate-900 p-5 rounded-xl border border-slate-800 shadow-md">
    <div className="flex items-center justify-between mb-2 text-slate-400">
    <span className="font-bold tracking-wider text-xs uppercase">Battery Level</span>
    {renderBatteryIcon()}
    </div>
    <div className="flex items-baseline gap-2 mt-2">
    <span className="text-4xl sm:text-5xl font-black">
    {latest ? `${batteryPct}%` : "--"}
    </span>
    <span className="text-sm font-semibold text-slate-500">
    {latest?.battery_voltage ? `${latest.battery_voltage}V` : ""}
    </span>
    </div>
    </div>

    <div className="bg-slate-900 p-5 rounded-xl border border-slate-800 shadow-md">
    <div className="flex items-center justify-between mb-2 text-slate-400">
    <span className="font-bold tracking-wider text-xs uppercase">Health Score</span>
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
    onChange={(e) => { setTimeRange(e.target.value); setIsHistorical(false); }}
    className="bg-slate-950 border border-slate-700 text-sm rounded-lg px-3 py-2 text-white outline-none focus:border-blue-500 transition-colors w-full sm:w-auto cursor-pointer"
    disabled={isHistorical}
    >
    <option value="1h">1 Hour</option>
    <option value="3h">3 Hours</option>
    <option value="6h">6 Hours</option>
    <option value="12h">12 Hours</option>
    <option value="1d">1 Day</option>
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
    onChange={(e) => setTimeMode(e.target.value as "rolling" | "absolute")}
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
    onChange={(e) => setIsHistorical(e.target.checked)}
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
      onChange={(e) => setCustomStart(e.target.value)}
      className="bg-slate-950 border border-slate-700 text-sm rounded-lg px-3 py-2 text-white outline-none focus:border-blue-500 cursor-pointer w-full sm:w-auto"
      />
      </div>
      <div className="flex flex-col gap-1 w-full sm:w-auto">
      <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">End Date & Time</label>
      <input
      type="datetime-local"
      value={customEnd}
      onClick={(e) => (e.target as HTMLInputElement).showPicker && (e.target as HTMLInputElement).showPicker()}
      onChange={(e) => setCustomEnd(e.target.value)}
      className="bg-slate-950 border border-slate-700 text-sm rounded-lg px-3 py-2 text-white outline-none focus:border-blue-500 cursor-pointer w-full sm:w-auto"
      />
      </div>
      </div>
    )}
    </div>

    {/* Breach Log */}
    <div className="bg-slate-900 p-5 rounded-xl border border-slate-800 shadow-md overflow-hidden">
    <h2 className="text-lg font-bold mb-4 flex items-center gap-2 text-red-400 uppercase tracking-wider">
    <AlertTriangle size={20} /> Period Breach Log
    </h2>
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
        <tr key={inc.id} className="border-b border-slate-800 hover:bg-slate-800/50 transition-colors">
        <td className="py-3 px-4">{format(new Date(String(inc.start_time)), "MMM d, HH:mm:ss")}</td>
        <td className="py-3 px-4">{inc.end_time ? format(new Date(String(inc.end_time)), "MMM d, HH:mm:ss") : <span className="text-red-500 font-bold animate-pulse">ACTIVE</span>}</td>
        <td className="py-3 px-4">{calculateDuration(inc.start_time, inc.end_time)}</td>
        <td className="py-3 px-4 font-mono text-red-400 bg-red-950/20">{inc.peak_temperature}°C</td>
        </tr>
      ))
    )}
    </tbody>
    </table>
    </div>
    </div>

    {/* Temperature Graph & Stats */}
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
    <div className="lg:col-span-3 bg-slate-900 p-5 rounded-xl border border-slate-800 shadow-md">
    <h2 className="text-lg font-bold mb-6 flex items-center gap-2 uppercase tracking-wider">
    <Activity size={20} className="text-blue-500" /> Temperature Trend
    </h2>
    <div className="w-full overflow-x-auto pb-4">
    <div className="h-[400px] min-w-[700px]">
    <ResponsiveContainer width="100%" height="100%">
    <LineChart data={downsampledTelemetry} margin={{ top: 10, right: 30, bottom: 5, left: -10 }}>
    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
    <XAxis
    dataKey="timeMs"
    type="number"
    domain={['dataMin', 'dataMax']}
    scale="time"
    stroke="#64748b"
    tickFormatter={(ms: any) => format(new Date(Number(ms)), timeRange.includes("d") || timeRange.includes("mo") || timeRange.includes("w") || timeRange.includes("y") || isHistorical ? "MMM d" : "HH:mm")}
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
    labelFormatter={(label: any) => format(new Date(Number(label)), "PP pp")}
    />
    <ReferenceLine y={8.0} stroke="#ef4444" strokeDasharray="4 4" label={{ value: "Upper Bound (8°C)", fill: "#ef4444", position: "insideTopLeft", offset: 10 }} />
    <ReferenceLine y={2.0} stroke="#ef4444" strokeDasharray="4 4" label={{ value: "Lower Bound (2°C)", fill: "#ef4444", position: "insideBottomRight", offset: 10 }} />
    <Line type="monotone" dataKey="temperature" stroke="#3b82f6" strokeWidth={3} dot={false} activeDot={{ r: 6, fill: "#60a5fa", strokeWidth: 0 }} />
    </LineChart>
    </ResponsiveContainer>
    </div>
    </div>
    </div>

    {/* Period Analytics Panel */}
    <div className="bg-slate-900 p-5 rounded-xl border border-slate-800 shadow-md flex flex-col gap-6">
    <h2 className="text-lg font-bold flex items-center gap-2 uppercase tracking-wider text-slate-300">
    <ThermometerSnowflake size={20} className="text-blue-400" /> Period Analytics
    </h2>
    <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 flex flex-col gap-1">
    <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Average Temp</span>
    <span className="text-3xl font-black text-white">{avgTemp}°C</span>
    </div>
    <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 flex flex-col gap-1">
    <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Peak Max</span>
    <span className="text-3xl font-black text-red-400">{maxTemp}°C</span>
    </div>
    <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 flex flex-col gap-1">
    <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Deepest Min</span>
    <span className="text-3xl font-black text-blue-400">{minTemp}°C</span>
    </div>
    </div>
    </div>

    </div>
    </div>
  );
}
