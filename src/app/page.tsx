"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from "recharts";
import { format } from "date-fns";
import { Activity, Battery, Clock, AlertTriangle, Wifi, WifiOff } from "lucide-react";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const calculateDuration = (start: string, end: string | null) => {
  if (!end) return "--";
  const startTime = new Date(start).getTime();
  const endTime = new Date(end).getTime();
  const totalSeconds = Math.floor((endTime - startTime) / 1000);

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
  if (!voltage) return "--";
  const minV = 3.3;
  const maxV = 4.2;
  let percentage = Math.round(((voltage - minV) / (maxV - minV)) * 100);
  percentage = Math.max(0, Math.min(100, percentage));
  return `${percentage}%`;
};

export default function Dashboard() {
  const [telemetry, setTelemetry] = useState<any[]>([]);
  const [incidents, setIncidents] = useState<any[]>([]);
  const [latest, setLatest] = useState<any>(null);
  const [isOffline, setIsOffline] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      const { data: tData } = await supabase
      .from("telemetry")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(144);

      const { data: iData } = await supabase
      .from("incidents")
      .select("*")
      .order("start_time", { ascending: false })
      .limit(20);

      if (tData && tData.length > 0) {
        const formatted = [...tData].reverse().map(d => ({
          ...d,
          timeMs: new Date(String(d.created_at)).getTime()
        }));

        setTelemetry(formatted);
        setLatest(tData[0]);

        const lastPing = new Date(String(tData[0].created_at)).getTime();
        const now = new Date().getTime();
        setIsOffline(now - lastPing > 210000);
      }

      if (iData) setIncidents(iData);
    };

      fetchData();
      const interval = setInterval(fetchData, 10000);
      return () => clearInterval(interval);
  }, []);

  const getStatusColor = (status: string, offline: boolean) => {
    if (offline) return "bg-gray-500";
    if (status === "BREACH") return "bg-red-500 animate-pulse";
    if (status === "WARNING") return "bg-yellow-500";
    return "bg-green-500";
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-4 sm:p-6 font-sans">
    <div className="max-w-6xl mx-auto space-y-6">

    <div className={`p-4 rounded-lg flex items-center justify-between ${getStatusColor(latest?.status, isOffline)} transition-colors duration-500`}>
    <div>
    <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">Cold Chain Monitor</h1>
    <p className="text-white/80 font-medium text-sm sm:text-base">
    {isOffline ? "SYSTEM OFFLINE - WATCHDOG TRIGGERED" : `SYSTEM STATUS: ${latest?.status || "INITIALIZING"}`}
    </p>
    </div>
    {isOffline ? <WifiOff size={28} className="text-white shrink-0 ml-4" /> : <Wifi size={28} className="text-white shrink-0 ml-4" />}
    </div>

    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
    <div className="bg-slate-800 p-5 rounded-lg border border-slate-700 shadow-sm">
    <div className="flex items-center justify-between mb-2 text-slate-400">
    <span className="font-semibold tracking-wider text-sm uppercase">Current Temp</span>
    <Activity size={20} />
    </div>
    <div className="text-4xl sm:text-5xl font-bold">
    {latest ? `${latest.temperature}°C` : "--"}
    </div>
    </div>

    <div className="bg-slate-800 p-5 rounded-lg border border-slate-700 shadow-sm">
    <div className="flex items-center justify-between mb-2 text-slate-400">
    <span className="font-semibold tracking-wider text-sm uppercase">Battery Level</span>
    <Battery size={20} />
    </div>
    <div className="flex items-baseline gap-2 mt-1">
    <span className="text-4xl sm:text-5xl font-bold">
    {latest?.battery_voltage ? getBatteryPercentage(latest.battery_voltage) : "--"}
    </span>
    <span className="text-sm font-medium text-slate-400">
    {latest?.battery_voltage ? `${latest.battery_voltage}V` : ""}
    </span>
    </div>
    </div>

    <div className="bg-slate-800 p-5 rounded-lg border border-slate-700 shadow-sm">
    <div className="flex items-center justify-between mb-2 text-slate-400">
    <span className="font-semibold tracking-wider text-sm uppercase">Last Update</span>
    <Clock size={20} />
    </div>
    <div className="text-lg sm:text-xl font-medium mt-3">
    {latest ? format(new Date(String(latest.created_at)), "MMM d, yyyy") : "--"}
    <br />
    {latest ? format(new Date(String(latest.created_at)), "hh:mm:ss a") : "--"}
    </div>
    </div>
    </div>

    <div className="bg-slate-800 p-5 rounded-lg border border-slate-700 shadow-sm">
    <h2 className="text-lg font-semibold mb-6 flex items-center gap-2">
    <Activity size={20} className="text-blue-400" /> Temperature Trend
    </h2>
    <div className="w-full overflow-x-auto pb-4">
    <div className="h-80 min-w-[600px] md:min-w-full">
    <ResponsiveContainer width="100%" height="100%">
    <LineChart data={telemetry} margin={{ top: 5, right: 20, bottom: 5, left: -20 }}>
    <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
    <XAxis
    dataKey="timeMs"
    type="number"
    domain={['dataMin', 'dataMax']}
    stroke="#94a3b8"
    tickFormatter={(ms: any) => format(new Date(Number(ms)), "HH:mm")}
    tickCount={8}
    />
    <YAxis
    stroke="#94a3b8"
    domain={[
      (dataMin: number) => Math.min(0, Math.floor(dataMin - 2)),
          (dataMax: number) => Math.max(12, Math.ceil(dataMax + 2))
    ]}
    />
    <Tooltip
    contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#f8fafc' }}
    labelFormatter={(label: any) => format(new Date(Number(label)), "PP pp")}
    />
    <ReferenceLine y={8.0} stroke="#ef4444" strokeDasharray="3 3" label={{ value: "Upper Bound (8°C)", fill: "#ef4444", position: "insideTopLeft" }} />
    <ReferenceLine y={2.0} stroke="#ef4444" strokeDasharray="3 3" label={{ value: "Lower Bound (2°C)", fill: "#ef4444", position: "insideBottomLeft" }} />
    <Line type="monotone" dataKey="temperature" stroke="#3b82f6" strokeWidth={3} dot={{ r: 4, fill: "#3b82f6", strokeWidth: 0 }} activeDot={{ r: 6 }} />
    </LineChart>
    </ResponsiveContainer>
    </div>
    </div>
    </div>

    <div className="bg-slate-800 p-5 rounded-lg border border-slate-700 shadow-sm overflow-hidden">
    <h2 className="text-lg font-semibold mb-6 flex items-center gap-2 text-red-400">
    <AlertTriangle size={20} /> Breach Incident Log
    </h2>
    <div className="overflow-x-auto">
    <table className="w-full text-left border-collapse whitespace-nowrap">
    <thead>
    <tr className="border-b border-slate-700 text-slate-400 text-sm tracking-wider uppercase">
    <th className="pb-3 px-4">Start Time</th>
    <th className="pb-3 px-4">End Time</th>
    <th className="pb-3 px-4">Duration</th>
    <th className="pb-3 px-4">Peak Temp</th>
    </tr>
    </thead>
    <tbody className="text-slate-200 text-sm sm:text-base">
    {incidents.length === 0 ? (
      <tr>
      <td colSpan={4} className="py-6 text-center text-slate-500">No thermal breaches recorded.</td>
      </tr>
    ) : (
      incidents.map((inc) => (
        <tr key={inc.id} className="border-b border-slate-700/50 hover:bg-slate-700/20 transition-colors">
        <td className="py-3 px-4">{format(new Date(String(inc.start_time)), "MMM d, hh:mm:ss a")}</td>
        <td className="py-3 px-4">{inc.end_time ? format(new Date(String(inc.end_time)), "MMM d, hh:mm:ss a") : <span className="text-red-400 font-semibold animate-pulse">ACTIVE</span>}</td>
        <td className="py-3 px-4">{calculateDuration(inc.start_time, inc.end_time)}</td>
        <td className="py-3 px-4 font-mono text-red-400">{inc.peak_temperature}°C</td>
        </tr>
      ))
    )}
    </tbody>
    </table>
    </div>
    </div>

    </div>
    </div>
  );
}
