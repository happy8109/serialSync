import React, { useState, useEffect } from 'react';
import { Globe, RefreshCw, Server, Play, Activity, Database, ArrowRight } from 'lucide-react';
import { cn } from '../../lib/utils';

export default function ServiceManager() {
    const [localServices, setLocalServices] = useState([]);
    const [remoteServices, setRemoteServices] = useState([]);
    const [loading, setLoading] = useState(false);
    const [querying, setQuerying] = useState(false);

    // Call Result Modal State
    const [callResult, setCallResult] = useState(null);
    const [callingServiceId, setCallingServiceId] = useState(null);

    useEffect(() => {
        fetchLocalServices();
        fetchRemoteServices(); // Load cached
    }, []);

    const fetchLocalServices = async () => {
        try {
            const res = await fetch('/api/services/local');
            const data = await res.json();
            if (data.success) setLocalServices(data.data);
        } catch (e) {
            console.error(e);
        }
    };

    const fetchRemoteServices = async () => {
        try {
            const res = await fetch('/api/services/remote');
            const data = await res.json();
            if (data.success) setRemoteServices(data.data);
        } catch (e) {
            console.error(e);
        }
    };

    const handleQueryRemote = async () => {
        setQuerying(true);
        try {
            await fetch('/api/services/remote/query', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });
            // 轮询几次获取结果
            let attempts = 0;
            const interval = setInterval(async () => {
                await fetchRemoteServices();
                attempts++;
                if (attempts >= 5) {
                    clearInterval(interval);
                    setQuerying(false);
                }
            }, 1000);
        } catch (e) {
            console.error(e);
            setQuerying(false);
        }
    };

    const handleCallService = async (serviceId) => {
        setCallingServiceId(serviceId);
        setCallResult(null);
        try {
            const res = await fetch(`/api/services/remote/${serviceId}/call`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}) // Default empty params
            });
            const data = await res.json();
            setCallResult(data);
        } catch (e) {
            setCallResult({ error: e.message });
        } finally {
            setCallingServiceId(null);
        }
    };

    return (
        <div className="flex flex-col h-full bg-muted/10">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card/50">
                <h2 className="font-semibold flex items-center gap-2">
                    <Globe size={18} className="text-blue-500" />
                    API Forwarding
                </h2>
                <div className="flex gap-2">
                    <button
                        onClick={handleQueryRemote}
                        disabled={querying}
                        className={cn(
                            "p-1.5 hover:bg-muted rounded-md transition-all text-xs flex items-center gap-1 border border-border/50",
                            querying && "animate-pulse text-blue-500"
                        )}
                        title="Discover Remote Services"
                    >
                        <RefreshCw size={14} className={cn(querying && "animate-spin")} />
                        {querying ? 'Discovering...' : 'Discovery'}
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-6">

                {/* Local Services Section */}
                <section>
                    <div className="flex items-center gap-2 mb-3 px-1">
                        <Server size={16} className="text-green-500" />
                        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Local Services</h3>
                        <span className="ml-auto text-xs bg-muted px-2 py-0.5 rounded-full">{localServices.length}</span>
                    </div>

                    <div className="grid grid-cols-1 gap-3">
                        {localServices.length === 0 && (
                            <div className="text-center py-8 text-muted-foreground text-sm bg-card/30 rounded-lg border border-border/50 border-dashed">
                                No local services configured.
                            </div>
                        )}
                        {localServices.map(service => (
                            <div key={service.id} className="bg-card border border-border/50 rounded-lg p-3 hover:border-blue-500/30 transition-colors group">
                                <div className="flex justify-between items-start mb-2">
                                    <div>
                                        <div className="font-medium flex items-center gap-2">
                                            {service.name || service.id}
                                            {service.enabled ?
                                                <span className="w-1.5 h-1.5 rounded-full bg-green-500" title="Enabled"></span> :
                                                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" title="Disabled"></span>
                                            }
                                        </div>
                                        <div className="text-xs text-muted-foreground mt-0.5 font-mono">{service.id}</div>
                                    </div>
                                    <div className="text-xs bg-muted px-1.5 py-0.5 rounded text-muted-foreground group-hover:bg-blue-500/10 group-hover:text-blue-500 transition-colors">
                                        {service.method}
                                    </div>
                                </div>
                                <div className="text-xs text-muted-foreground truncate" title={service.endpoint}>
                                    Target: {service.endpoint}
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                {/* Remote Services Section */}
                <section>
                    <div className="flex items-center gap-2 mb-3 px-1">
                        <Database size={16} className="text-orange-500" />
                        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Remote Services</h3>
                        <span className="ml-auto text-xs bg-muted px-2 py-0.5 rounded-full">{remoteServices.length}</span>
                    </div>

                    <div className="grid grid-cols-1 gap-3">
                        {remoteServices.length === 0 && (
                            <div className="text-center py-8 text-muted-foreground text-sm bg-card/30 rounded-lg border border-border/50 border-dashed">
                                Click "Discovery" to find remote services.
                            </div>
                        )}
                        {remoteServices.map(service => (
                            <div key={service.id} className="bg-card border border-border/50 rounded-lg p-3 hover:border-orange-500/30 transition-colors">
                                <div className="flex justify-between items-start mb-3">
                                    <div>
                                        <div className="font-medium flex items-center gap-2 text-foreground">
                                            {service.name || service.id}
                                        </div>
                                        <div className="text-xs text-muted-foreground mt-0.5">{service.description || 'No description'}</div>
                                    </div>
                                    <button
                                        onClick={() => handleCallService(service.id)}
                                        disabled={callingServiceId === service.id}
                                        className="p-1.5 bg-primary/10 hover:bg-primary/20 text-primary rounded-md transition-colors disabled:opacity-50"
                                        title="Call Service"
                                    >
                                        {callingServiceId === service.id ?
                                            <Activity size={16} className="animate-spin" /> :
                                            <Play size={16} fill="currentColor" />
                                        }
                                    </button>
                                </div>

                                {callingServiceId === service.id && (
                                    <div className="text-xs text-blue-500 animate-pulse mt-2 flex items-center gap-1">
                                        <Activity size={12} /> Calling remote service...
                                    </div>
                                )}

                                {/* Result Display Area */}
                                {callResult && callingServiceId === null /* Show result if this service was just called? No, logic needs tweak to stick result to service */}
                            </div>
                        ))}
                    </div>
                </section>
            </div>

            {/* Global Result Modal/Overlay (Simplified for now) */}
            {callResult && (
                <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center p-6 z-50">
                    <div className="bg-card border border-border shadow-xl rounded-xl w-full max-w-md max-h-[80vh] flex flex-col animate-in fade-in zoom-in-95 duration-200">
                        <div className="p-4 border-b border-border flex justify-between items-center bg-muted/20">
                            <h3 className="font-semibold flex items-center gap-2">
                                <Activity size={18} className="text-green-500" />
                                Call Result
                            </h3>
                            <button onClick={() => setCallResult(null)} className="text-muted-foreground hover:text-foreground">✕</button>
                        </div>
                        <div className="p-4 overflow-auto font-mono text-xs whitespace-pre-wrap">
                            {JSON.stringify(callResult, null, 2)}
                        </div>
                        <div className="p-3 border-t border-border bg-muted/20 text-center">
                            <button
                                onClick={() => setCallResult(null)}
                                className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
