import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(req: Request) {
    try {
        const { temperature } = await req.json();

        let status = 'SAFE';
        if (temperature > 8.0 || temperature < 2.0) status = 'BREACH';
        else if (temperature >= 7.1 || temperature <= 2.9) status = 'WARNING';

        const { data: activeIncidents } = await supabase
        .from('incidents')
        .select('*')
        .is('end_time', null)
        .order('start_time', { ascending: false })
        .limit(1);

        const activeIncident = activeIncidents?.[0];
        let event_type = 'ROUTINE';

        if (activeIncident) {
            const isColdBreach = activeIncident.peak_temperature < 2.0;
            const isHotBreach = activeIncident.peak_temperature > 8.0;

            const recoveredFromCold = isColdBreach && temperature >= 2.5;
            const recoveredFromHot = isHotBreach && temperature <= 7.5;

            if (recoveredFromCold || recoveredFromHot) {
                event_type = 'BREACH_FIX';
                await supabase
                .from('incidents')
                .update({ end_time: new Date().toISOString() })
                .eq('id', activeIncident.id);
            } else {
                status = 'BREACH';
                let newPeak = activeIncident.peak_temperature;
                if (isHotBreach && temperature > activeIncident.peak_temperature) newPeak = temperature;
                if (isColdBreach && temperature < activeIncident.peak_temperature) newPeak = temperature;

                if (newPeak !== activeIncident.peak_temperature) {
                    await supabase
                    .from('incidents')
                    .update({ peak_temperature: newPeak })
                    .eq('id', activeIncident.id);
                }
            }
        } else if (status === 'BREACH') {
            event_type = 'BREACH_START';
            await supabase
            .from('incidents')
            .insert([{ peak_temperature: temperature, start_time: new Date().toISOString() }]);
        }

        await supabase.from('telemetry').insert([{
            temperature,
            status,
            event_type
        }]);

        let lastBreachFormatted = "--:--:--";
        const { data: lastIncidentData } = await supabase
        .from('incidents')
        .select('start_time')
        .order('start_time', { ascending: false })
        .limit(1);

        if (lastIncidentData && lastIncidentData.length > 0) {
            const d = new Date(lastIncidentData[0].start_time);
            lastBreachFormatted = d.toLocaleTimeString('en-US', { timeZone: 'Asia/Dhaka', hour12: false });
        }

        return NextResponse.json({ success: true, last_breach: lastBreachFormatted });
    } catch (error) {
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
