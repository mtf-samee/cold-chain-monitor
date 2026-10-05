import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
);

export async function POST(request: Request) {
    const apiKey = request.headers.get('x-api-key');
    if (apiKey !== process.env.API_SECRET_KEY) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const body = await request.json();
        const { temperature, status, event_type, battery_voltage, duration_seconds, peak_temperature } = body;

        const { error: telemetryError } = await supabase
        .from('telemetry')
        .insert([{ temperature, status, event_type, battery_voltage }]);

        if (telemetryError) throw telemetryError;

        if (event_type === 'BREACH_START') {
            const { error: incidentError } = await supabase
            .from('incidents')
            .insert([{
                start_time: new Date().toISOString(),
                    peak_temperature: temperature
            }]);

            if (incidentError) throw incidentError;

        } else if (event_type === 'BREACH_FIX') {
            const { data: latestIncident, error: fetchError } = await supabase
            .from('incidents')
            .select('id')
            .order('start_time', { ascending: false })
            .limit(1)
            .single();

            if (fetchError && fetchError.code !== 'PGRST116') throw fetchError;

            if (latestIncident) {
                const { error: updateError } = await supabase
                .from('incidents')
                .update({
                    end_time: new Date().toISOString(),
                        duration_seconds,
                        peak_temperature
                })
                .eq('id', latestIncident.id);

                if (updateError) throw updateError;
            }
        }

        return NextResponse.json({ success: true }, { status: 201 });
    } catch (error: any) {
        console.error("DATABASE ERROR:", error);
        return NextResponse.json({
            error: 'Internal Server Error',
            message: error.message || 'Unknown database error',
            details: error
        }, { status: 500 });
    }
}
