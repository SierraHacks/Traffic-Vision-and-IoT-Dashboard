import React, { useState, useEffect, useRef } from "react";
import {
  Camera, MapPin, AlertTriangle, Activity, Gauge, Bell, Radio,
  ChevronRight, Eye, EyeOff, Zap, AlertOctagon,
  Navigation2, Loader2, LocateFixed, ExternalLink,
  Users, Car as CarIcon, TrendingUp
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid
} from "recharts";

const COLORS = {
  bg: "#0A0F1A",
  panel: "#111A2C",
  panelAlt: "#0D1524",
  border: "rgba(148,163,184,0.14)",
  borderStrong: "rgba(148,163,184,0.26)",
  text: "#E8EDF5",
  textDim: "#8A96AC",
  textFaint: "#526079",
  teal: "#22C4B4",
  tealDim: "rgba(34,196,180,0.15)",
  orange: "#F2894E",
  orangeDim: "rgba(242,137,78,0.15)",
  violet: "#A47BF0",
  violetDim: "rgba(164,123,240,0.15)",
  green: "#3ECF8E",
  greenDim: "rgba(62,207,142,0.15)",
  amber: "#FFC24B",
  red: "#FF5D6C",
  redDim: "rgba(255,93,108,0.15)",
  crit: "#FF3B4E",
  critDim: "rgba(255,59,78,0.16)",
};

// fallback location if geolocation is denied/unavailable (Worcester, MA)
const DEMO_LOCATION = { lat: 42.2626, lng: -71.8023, label: "Worcester, MA (demo)" };

function toRad(d) { return (d * Math.PI) / 180; }
function haversineMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const ACCIDENT_KINDS = [
  "2-vehicle collision", "Rear-end collision", "Single-vehicle rollover",
  "Motorcycle collision", "Multi-vehicle pileup",
];

function generateNearbyAccidents(lat, lng, count = 3) {
  const out = [];
  for (let i = 0; i < count; i++) {
    // offset within roughly 0.3 - 4.5 miles
    const dLat = (Math.random() - 0.5) * 0.06;
    const dLng = (Math.random() - 0.5) * 0.06;
    const aLat = lat + dLat;
    const aLng = lng + dLng;
    out.push({
      id: i,
      kind: ACCIDENT_KINDS[Math.floor(Math.random() * ACCIDENT_KINDS.length)],
      lat: aLat,
      lng: aLng,
      distance: haversineMiles(lat, lng, aLat, aLng),
      minutesAgo: Math.floor(Math.random() * 22) + 1,
      lanesBlocked: Math.random() > 0.5,
    });
  }
  return out.sort((a, b) => a.distance - b.distance);
}

const volumeData = [
  { t: "6a", v: 120 }, { t: "8a", v: 410 }, { t: "10a", v: 260 },
  { t: "12p", v: 300 }, { t: "2p", v: 280 }, { t: "4p", v: 390 },
  { t: "6p", v: 460 }, { t: "8p", v: 210 }, { t: "10p", v: 90 },
];

const ALERT_TEMPLATES = [
  { label: "Stalled vehicle", loc: "5th & Main", sev: "high" },
  { label: "Pedestrian surge", loc: "Elm Crossing", sev: "med" },
  { label: "Congestion building", loc: "Route 9 N", sev: "med" },
  { label: "Signal timing drift", loc: "Oak & 3rd", sev: "low" },
  { label: "Speeding cluster", loc: "River Rd", sev: "high" },
  { label: "Crosswalk occupancy", loc: "Depot Sq", sev: "low" },
  { label: "Collision detected", loc: "5th & Main", sev: "critical" },
  { label: "Multi-vehicle collision", loc: "Route 9 N", sev: "critical" },
];

const MAP_PINS = [
  { id: "p1", x: 92, y: 74, label: "5th & Main", congestion: "high" },
  { id: "p2", x: 210, y: 130, label: "Elm Crossing", congestion: "med" },
  { id: "p3", x: 150, y: 210, label: "Route 9 N", congestion: "med" },
  { id: "p4", x: 260, y: 60, label: "Oak & 3rd", congestion: "low" },
  { id: "p5", x: 60, y: 190, label: "River Rd", congestion: "high" },
  { id: "p6", x: 300, y: 190, label: "Depot Sq", congestion: "low" },
];

function sevColor(sev) {
  if (sev === "critical") return COLORS.crit;
  if (sev === "high") return COLORS.red;
  if (sev === "med") return COLORS.amber;
  return COLORS.teal;
}
function congColor(c) {
  if (c === "high") return COLORS.red;
  if (c === "med") return COLORS.amber;
  return COLORS.green;
}

let alertSeq = 1;

export default function Dashboard() {
  const [active, setActive] = useState(true);
  const [clock, setClock] = useState(new Date());
  const [carCount, setCarCount] = useState(5);
  const [personCount, setPersonCount] = useState(12);
  const [alerts, setAlerts] = useState([
    { id: 0, ...ALERT_TEMPLATES[0], time: "12:41:02", pin: "p1" },
    { id: -1, ...ALERT_TEMPLATES[2], time: "12:38:47", pin: "p3" },
  ]);
  const [selectedAlert, setSelectedAlert] = useState(0);
  const feedRef = useRef(null);

  // collision detection
  const [collision, setCollision] = useState(false);

  // "accidents near you"
  const [locStatus, setLocStatus] = useState("idle"); // idle | loading | granted | demo | denied
  const [userLoc, setUserLoc] = useState(null);
  const [nearby, setNearby] = useState([]);

  // clock
  useEffect(() => {
    const iv = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(iv);
  }, []);

  // live-ish counters only tick when in active/THV mode
  useEffect(() => {
    if (!active) return;
    const iv = setInterval(() => {
      setCarCount((c) => Math.max(1, c + (Math.random() > 0.5 ? 1 : -1)));
      setPersonCount((p) => Math.max(0, p + (Math.random() > 0.55 ? 1 : -1)));
    }, 1800);
    return () => clearInterval(iv);
  }, [active]);

  // simulated incoming alerts
  useEffect(() => {
    const iv = setInterval(() => {
      const t = ALERT_TEMPLATES[Math.floor(Math.random() * ALERT_TEMPLATES.length)];
      const pin = MAP_PINS[Math.floor(Math.random() * MAP_PINS.length)];
      alertSeq += 1;
      const now = new Date();
      const time = now.toLocaleTimeString("en-US", { hour12: false });
      setAlerts((prev) => [
        { id: alertSeq, ...t, time, pin: pin.id },
        ...prev,
      ].slice(0, 6));
    }, 7000);
    return () => clearInterval(iv);
  }, []);

  // occasionally auto-trigger a collision detection event in THV mode
  useEffect(() => {
    if (!active) return;
    const iv = setInterval(() => {
      if (Math.random() > 0.55) triggerCollision();
    }, 16000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  function triggerCollision() {
    setCollision(true);
    alertSeq += 1;
    const now = new Date();
    setAlerts((prev) => [
      { id: alertSeq, label: "Collision detected", loc: "5th & Main", sev: "critical",
        time: now.toLocaleTimeString("en-US", { hour12: false }), pin: "p1" },
      ...prev,
    ].slice(0, 6));
    setSelectedAlert(alertSeq);
    setTimeout(() => setCollision(false), 4200);
  }

  function checkNearbyAccidents() {
    setLocStatus("loading");
    if (!("geolocation" in navigator)) {
      const d = DEMO_LOCATION;
      setUserLoc(d);
      setNearby(generateNearbyAccidents(d.lat, d.lng));
      setLocStatus("demo");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const d = { lat: pos.coords.latitude, lng: pos.coords.longitude, label: "Your location" };
        setUserLoc(d);
        setNearby(generateNearbyAccidents(d.lat, d.lng));
        setLocStatus("granted");
      },
      () => {
        const d = DEMO_LOCATION;
        setUserLoc(d);
        setNearby(generateNearbyAccidents(d.lat, d.lng));
        setLocStatus("demo");
      },
      { timeout: 6000 }
    );
  }

  const currentAlert = alerts.find((a) => a.id === selectedAlert) || alerts[0];
  const activePin = MAP_PINS.find((p) => p.id === currentAlert?.pin);

  const timeStr = clock.toLocaleTimeString("en-US", { hour12: true });

  return (
    <div style={{
      background: COLORS.bg, color: COLORS.text, minHeight: "100%",
      fontFamily: "'Inter', sans-serif", padding: "18px",
      display: "flex", flexDirection: "column", gap: "14px",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@400;500;600&display=swap');
        .mono { font-family: 'IBM Plex Mono', monospace; }
        .disp { font-family: 'Space Grotesk', sans-serif; }
        @keyframes pulseDot { 0%,100% { opacity:1; } 50% { opacity:0.35; } }
        @keyframes fadeIn { from { opacity:0; transform: translateY(-4px);} to { opacity:1; transform: translateY(0);} }
        @keyframes drawBox { from { stroke-dashoffset: 240; opacity:0; } to { stroke-dashoffset: 0; opacity:1; } }
        @keyframes scan { 0% { transform: translateY(-100%);} 100% { transform: translateY(100%);} }
        @keyframes critPulse { 0%,100% { opacity:1; } 50% { opacity:0.55; } }
        .critPulse { animation: critPulse 0.7s ease infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .spin { animation: spin 0.8s linear infinite; }
        .alertRow { animation: fadeIn 0.35s ease; }
        .bbox { stroke-dasharray: 240; animation: drawBox 0.6s ease forwards; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-thumb { background: rgba(148,163,184,0.25); border-radius: 4px; }
      `}</style>

      {/* HEADER */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        borderBottom: `1px solid ${COLORS.border}`, paddingBottom: "14px",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{
            width: 38, height: 38, borderRadius: 10, background: COLORS.tealDim,
            display: "flex", alignItems: "center", justifyContent: "center",
            border: `1px solid ${COLORS.teal}`,
          }}>
            <Radio size={18} color={COLORS.teal} />
          </div>
          <div>
            <div className="disp" style={{ fontSize: 19, fontWeight: 700, letterSpacing: 0.3 }}>
              GOSTLY <span style={{ color: COLORS.teal }}>· THV</span>
            </div>
            <div className="mono" style={{ fontSize: 11, color: COLORS.textFaint }}>
              TRAFFIC HEURISTIC VISION — CITY OPERATIONS
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "22px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <div style={{
              width: 8, height: 8, borderRadius: 99, background: COLORS.green,
              animation: "pulseDot 1.6s infinite",
            }} />
            <span className="mono" style={{ fontSize: 12, color: COLORS.green, letterSpacing: 1 }}>LIVE</span>
          </div>
          <div className="mono" style={{ fontSize: 13, color: COLORS.text, minWidth: 92, textAlign: "right" }}>
            {timeStr}
          </div>
        </div>
      </div>

      {/* MAIN GRID */}
      <div style={{ display: "grid", gridTemplateColumns: "1.15fr 1.4fr 1fr", gap: "14px" }}>

        {/* CAMERA FEED PANEL */}
        <Panel title="Intersection Camera" icon={<Camera size={15} color={COLORS.textDim} />}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <span className="mono" style={{ fontSize: 11, color: COLORS.textFaint }}>CAM-014 · 5th & Main</span>
            <ModeToggle active={active} setActive={setActive} />
          </div>

          <div ref={feedRef} style={{
            position: "relative", borderRadius: 10, overflow: "hidden",
            border: `1px solid ${collision ? COLORS.crit : COLORS.borderStrong}`, background: "#05070C", height: 210,
            transition: "border-color 0.15s ease",
            boxShadow: collision ? `0 0 0 1px ${COLORS.crit}, 0 0 18px ${COLORS.critDim}` : "none",
          }}>
            <CameraScene active={active} collision={collision} />
            <div style={{
              position: "absolute", inset: 0, background:
                "linear-gradient(180deg, rgba(34,196,180,0.06), transparent 40%)",
              pointerEvents: "none",
            }} />
            {active && !collision && (
              <div style={{
                position: "absolute", left: 0, right: 0, height: "18%",
                background: "linear-gradient(180deg, transparent, rgba(34,196,180,0.14), transparent)",
                animation: "scan 3.2s linear infinite", pointerEvents: "none",
              }} />
            )}
            {collision && (
              <div className="critPulse" style={{
                position: "absolute", top: 8, right: 8, display: "flex", alignItems: "center", gap: 5,
                background: COLORS.crit, color: "#0A0F1A", padding: "4px 8px", borderRadius: 6,
                fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4,
              }}>
                <AlertOctagon size={12} /> COLLISION DETECTED
              </div>
            )}
            <div className="mono" style={{
              position: "absolute", bottom: 6, left: 8, fontSize: 10,
              color: active ? (collision ? COLORS.crit : COLORS.teal) : COLORS.textFaint, letterSpacing: 0.5,
            }}>
              {collision ? "IMPACT SIGNATURE MATCH · AUTO-DISPATCHING"
                : active ? "MODE: THV ACTIVE DETECTION · YOLOv-mock" : "MODE: PASSIVE RAW FEED"}
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <StatChip icon={<CarIcon size={13} />} label="Cars" value={active ? carCount : "—"} color={COLORS.teal} />
            <StatChip icon={<Users size={13} />} label="People" value={active ? personCount : "—"} color={COLORS.orange} />
            <StatChip icon={active ? <Eye size={13} /> : <EyeOff size={13} />} label="Detection" value={active ? "ON" : "OFF"} color={active ? COLORS.green : COLORS.textFaint} />
          </div>

          <button
            onClick={triggerCollision}
            disabled={!active || collision}
            style={{
              marginTop: 10, width: "100%", padding: "7px", borderRadius: 8,
              background: COLORS.critDim, border: `1px solid ${COLORS.crit}`,
              color: COLORS.crit, fontSize: 11.5, fontWeight: 600,
              cursor: (!active || collision) ? "not-allowed" : "pointer",
              opacity: (!active || collision) ? 0.5 : 1,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            }}
          >
            <AlertOctagon size={13} /> Simulate collision event
          </button>

          <p style={{ fontSize: 11.5, color: COLORS.textFaint, marginTop: 10, lineHeight: 1.5 }}>
            {active
              ? "Bounding-box inference counts vehicles and pedestrians and flags abnormal impact signatures — sudden overlap, deceleration, deformation — as collisions in real time."
              : "Today's baseline: operators scrub raw footage manually to spot activity — no counts, no classification, no automatic crash detection."}
          </p>
        </Panel>

        {/* MAP PANEL */}
        <Panel title="Live GIS Map" icon={<MapPin size={15} color={COLORS.textDim} />}>
          <div style={{
            borderRadius: 10, border: `1px solid ${COLORS.borderStrong}`,
            background: COLORS.panelAlt, height: 210, position: "relative", overflow: "hidden",
          }}>
            <CityMap pins={MAP_PINS} selectedPinId={activePin?.id} onSelect={(pinId) => {
              const a = alerts.find((al) => al.pin === pinId);
              if (a) setSelectedAlert(a.id);
            }} />
          </div>
          <div style={{ display: "flex", gap: 14, marginTop: 12, fontSize: 11 }}>
            <LegendDot color={COLORS.red} label="High congestion" />
            <LegendDot color={COLORS.amber} label="Medium" />
            <LegendDot color={COLORS.green} label="Flowing" />
          </div>
          <div style={{
            marginTop: 12, display: "flex", justifyContent: "space-between",
            padding: "10px 12px", borderRadius: 8, background: COLORS.panelAlt,
            border: `1px solid ${COLORS.border}`,
          }}>
            <div>
              <div className="mono" style={{ fontSize: 10, color: COLORS.textFaint }}>AVG SPEED</div>
              <div className="mono" style={{ fontSize: 16, color: COLORS.amber, fontWeight: 600 }}>41 mph</div>
            </div>
            <div>
              <div className="mono" style={{ fontSize: 10, color: COLORS.textFaint }}>CONGESTION</div>
              <div className="mono" style={{ fontSize: 16, color: COLORS.red, fontWeight: 600 }}>HIGH</div>
            </div>
            <div>
              <div className="mono" style={{ fontSize: 10, color: COLORS.textFaint }}>INCIDENTS</div>
              <div className="mono" style={{ fontSize: 16, color: COLORS.text, fontWeight: 600 }}>{alerts.length}</div>
            </div>
          </div>
        </Panel>

        {/* ALERTS PANEL */}
        <Panel title="Alert-Driven Dashboard" icon={<Bell size={15} color={COLORS.textDim} />}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 172, overflowY: "auto", paddingRight: 2 }}>
            {alerts.map((a) => (
              <div
                key={a.id}
                className="alertRow"
                onClick={() => setSelectedAlert(a.id)}
                style={{
                  cursor: "pointer", padding: "8px 10px", borderRadius: 8,
                  background: selectedAlert === a.id ? COLORS.panelAlt : "transparent",
                  border: `1px solid ${selectedAlert === a.id ? sevColor(a.sev) : "transparent"}`,
                  display: "flex", alignItems: "center", gap: 8,
                }}
              >
                <AlertTriangle size={13} color={sevColor(a.sev)} style={{ flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {a.label}
                  </div>
                  <div className="mono" style={{ fontSize: 10, color: COLORS.textFaint }}>{a.loc} · {a.time}</div>
                </div>
                <ChevronRight size={13} color={COLORS.textFaint} />
              </div>
            ))}
          </div>

        </Panel>
      </div>

      {/* ACCIDENTS NEAR YOU */}
      <Panel title="Accidents Near You" icon={<Navigation2 size={15} color={COLORS.textDim} />}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
          <p style={{ fontSize: 11.5, color: COLORS.textFaint, maxWidth: 480, lineHeight: 1.5, margin: 0 }}>
            Cross-references your location against every camera-detected collision citywide, so you know before you turn onto the road.
          </p>
          <button
            onClick={checkNearbyAccidents}
            disabled={locStatus === "loading"}
            style={{
              padding: "9px 14px", borderRadius: 8, whiteSpace: "nowrap",
              background: COLORS.tealDim, border: `1px solid ${COLORS.teal}`,
              color: COLORS.teal, fontSize: 12.5, fontWeight: 600,
              cursor: locStatus === "loading" ? "wait" : "pointer",
              display: "flex", alignItems: "center", gap: 7,
            }}
          >
            {locStatus === "loading"
              ? <Loader2 size={14} className="spin" />
              : <LocateFixed size={14} />}
            {locStatus === "idle" ? "Check accidents near me" : "Refresh"}
          </button>
        </div>

        {locStatus === "idle" && (
          <div style={{
            border: `1px dashed ${COLORS.border}`, borderRadius: 8, padding: "18px",
            textAlign: "center", color: COLORS.textFaint, fontSize: 12,
          }}>
            Share your location to see how far you are from active incidents.
          </div>
        )}

        {locStatus !== "idle" && locStatus !== "loading" && (
          <>
            <div className="mono" style={{ fontSize: 10.5, color: COLORS.textFaint, marginBottom: 10 }}>
              {locStatus === "granted"
                ? "USING YOUR LIVE LOCATION"
                : `USING DEMO LOCATION · ${DEMO_LOCATION.label.toUpperCase()}`}
              {nearby.length > 0 && ` · NEAREST INCIDENT ${nearby[0].distance.toFixed(1)} MI AWAY`}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
              {nearby.map((a, i) => (
                <div key={a.id} style={{
                  background: COLORS.panelAlt, borderRadius: 10,
                  border: `1px solid ${i === 0 ? COLORS.crit : COLORS.border}`,
                  padding: "12px",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                    <AlertOctagon size={13} color={COLORS.crit} />
                    <span style={{ fontSize: 12.5, fontWeight: 600 }}>{a.kind}</span>
                  </div>
                  <div className="mono" style={{ fontSize: 20, fontWeight: 700, color: COLORS.crit }}>
                    {a.distance.toFixed(1)} <span style={{ fontSize: 11, color: COLORS.textFaint, fontWeight: 500 }}>mi away</span>
                  </div>
                  <div style={{ fontSize: 11, color: COLORS.textFaint, marginTop: 4 }}>
                    Reported {a.minutesAgo} min ago{a.lanesBlocked ? " · lanes blocked" : ""}
                  </div>
                  <a
                    href={`https://www.google.com/maps?q=${a.lat},${a.lng}`}
                    target="_blank" rel="noreferrer"
                    style={{
                      marginTop: 9, fontSize: 11, color: COLORS.teal, textDecoration: "none",
                      display: "flex", alignItems: "center", gap: 4,
                    }}
                  >
                    View route <ExternalLink size={11} />
                  </a>
                </div>
              ))}
            </div>
          </>
        )}
      </Panel>

      {/* KPI ROW */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
        <Kpi icon={<Activity size={15} />} label="Detections today" value="7,951" delta="+12.4%" color={COLORS.teal} />
        <Kpi icon={<Gauge size={15} />} label="Avg response time" value="3m 12s" delta="-41%" color={COLORS.green} />
        <Kpi icon={<Zap size={15} />} label="Active incidents" value={String(alerts.length)} delta="live" color={COLORS.amber} />
      </div>

      {/* CHART */}
      <Panel title="Traffic Volume — Today" icon={<TrendingUp size={15} color={COLORS.textDim} />}>
        <div style={{ height: 170 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={volumeData} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
              <CartesianGrid stroke={COLORS.border} vertical={false} />
              <XAxis dataKey="t" tick={{ fill: COLORS.textFaint, fontSize: 11 }} axisLine={{ stroke: COLORS.border }} tickLine={false} />
              <YAxis tick={{ fill: COLORS.textFaint, fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: COLORS.panelAlt, border: `1px solid ${COLORS.borderStrong}`, borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: COLORS.textDim }}
              />
              <Line type="monotone" dataKey="v" stroke={COLORS.teal} strokeWidth={2.4} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <div className="mono" style={{ textAlign: "center", fontSize: 10.5, color: COLORS.textFaint, paddingTop: 4 }}>
        CONCEPT VISUALIZATION · SIMULATED DATA · GOSTLY + TRAFFIC HEURISTIC VISION
      </div>
    </div>
  );
}

function Panel({ title, icon, children }) {
  return (
    <div style={{
      background: COLORS.panel, border: `1px solid ${COLORS.border}`,
      borderRadius: 12, padding: "14px", display: "flex", flexDirection: "column",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
        {icon}
        <span className="disp" style={{ fontSize: 13, fontWeight: 600, letterSpacing: 0.2 }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

function ModeToggle({ active, setActive }) {
  return (
    <div
      onClick={() => setActive(!active)}
      style={{
        width: 106, height: 26, borderRadius: 99, cursor: "pointer",
        background: active ? COLORS.tealDim : COLORS.orangeDim,
        border: `1px solid ${active ? COLORS.teal : COLORS.orange}`,
        position: "relative", display: "flex", alignItems: "center",
        transition: "background 0.3s",
      }}
    >
      <div style={{
        position: "absolute", top: 2, left: active ? 58 : 2, width: 46, height: 20,
        borderRadius: 99, background: active ? COLORS.teal : COLORS.orange,
        transition: "left 0.25s ease",
      }} />
      <span className="mono" style={{
        position: "absolute", left: 8, fontSize: 9, fontWeight: 600,
        color: active ? COLORS.textFaint : "#0A0F1A", zIndex: 1,
      }}>RAW</span>
      <span className="mono" style={{
        position: "absolute", right: 8, fontSize: 9, fontWeight: 600,
        color: active ? "#0A0F1A" : COLORS.textFaint, zIndex: 1,
      }}>THV</span>
    </div>
  );
}

function CameraScene({ active, collision }) {
  // simple abstract street scene; bounding boxes only when active
  return (
    <svg viewBox="0 0 400 210" width="100%" height="100%" preserveAspectRatio="xMidYMid slice"
      style={{ filter: active ? "none" : "grayscale(1) contrast(0.9) brightness(0.85)" }}>
      <rect x="0" y="0" width="400" height="210" fill="#0B0F16" />
      <rect x="0" y="120" width="400" height="90" fill="#141A24" />
      <rect x="0" y="150" width="400" height="4" fill="#2A3242" />
      <rect x="0" y="0" width="70" height="150" fill="#161D28" />
      <rect x="330" y="0" width="70" height="150" fill="#161D28" />
      <rect x="100" y="30" width="40" height="90" fill="#1B2330" />
      <rect x="180" y="10" width="55" height="110" fill="#1B2330" />
      <rect x="260" y="40" width="35" height="80" fill="#1B2330" />

      {collision ? (
        <g>
          <rect x="126" y="150" width="34" height="20" rx="4" fill={COLORS.crit} transform="rotate(-8 143 160)" />
          <rect x="158" y="152" width="34" height="20" rx="4" fill="#C9515F" transform="rotate(10 175 162)" />
          <g fill={COLORS.crit} opacity="0.9">
            <circle cx="168" cy="150" r="3" />
            <circle cx="178" cy="144" r="2" />
            <circle cx="160" cy="142" r="2.2" />
            <circle cx="172" cy="158" r="1.8" />
          </g>
          <rect className="bbox" x="112" y="130" width="96" height="52" rx="5" fill="none" stroke={COLORS.crit} strokeWidth="2" />
          <text x="112" y="126" fontSize="10" fontWeight="700" fill={COLORS.crit} fontFamily="IBM Plex Mono, monospace">COLLISION 0.98</text>
        </g>
      ) : (
      <g>
        <rect x="150" y="158" width="46" height="20" rx="4" fill={active ? "#3E6E8C" : "#5A5F66"} />
        {active && (
          <rect className="bbox" x="142" y="150" width="62" height="36" rx="4" fill="none" stroke={COLORS.teal} strokeWidth="1.6" />
        )}
        {active && (
          <text x="142" y="147" fontSize="9" fill={COLORS.teal} fontFamily="IBM Plex Mono, monospace">Car 0.94</text>
        )}
      </g>
      )}
      {/* pedestrians */}
      <g>
        <rect x="248" y="150" width="6" height="20" rx="2" fill={active ? "#C98A54" : "#6B6F75"} />
        <rect x="258" y="150" width="6" height="20" rx="2" fill={active ? "#C98A54" : "#6B6F75"} />
        <rect x="268" y="150" width="6" height="20" rx="2" fill={active ? "#C98A54" : "#6B6F75"} />
        {active && (
          <rect className="bbox" x="242" y="140" width="38" height="34" rx="4" fill="none" stroke={COLORS.orange} strokeWidth="1.6" />
        )}
        {active && (
          <text x="242" y="137" fontSize="9" fill={COLORS.orange} fontFamily="IBM Plex Mono, monospace">Person x3</text>
        )}
      </g>
      {/* second car far */}
      <g>
        <rect x="60" y="163" width="30" height="13" rx="3" fill={active ? "#3E6E8C" : "#5A5F66"} />
        {active && (
          <rect className="bbox" x="56" y="158" width="38" height="22" rx="3" fill="none" stroke={COLORS.teal} strokeWidth="1.2" />
        )}
      </g>
    </svg>
  );
}

function CityMap({ pins, selectedPinId, onSelect }) {
  return (
    <svg viewBox="0 0 360 210" width="100%" height="100%">
      <rect width="360" height="210" fill={COLORS.panelAlt} />
      {/* grid roads */}
      {[40, 110, 180, 250, 320].map((x) => (
        <line key={"v" + x} x1={x} y1="0" x2={x} y2="210" stroke={COLORS.border} strokeWidth="6" />
      ))}
      {[30, 90, 150, 210].map((y) => (
        <line key={"h" + y} x1="0" y1={y} x2="360" y2={y} stroke={COLORS.border} strokeWidth="6" />
      ))}
      {/* highlighted route */}
      <polyline points="40,74 110,74 110,130 210,130" fill="none" stroke={COLORS.red} strokeWidth="3" strokeDasharray="6 4" opacity="0.8" />
      {pins.map((p) => (
        <g key={p.id} onClick={() => onSelect(p.id)} style={{ cursor: "pointer" }}>
          {selectedPinId === p.id && (
            <circle cx={p.x} cy={p.y} r="12" fill={congColor(p.congestion)} opacity="0.25">
              <animate attributeName="r" values="10;16;10" dur="1.6s" repeatCount="indefinite" />
            </circle>
          )}
          <circle cx={p.x} cy={p.y} r="6" fill={congColor(p.congestion)} stroke="#05070C" strokeWidth="1.5" />
          {selectedPinId === p.id && (
            <text x={p.x + 10} y={p.y - 8} fontSize="9.5" fill={COLORS.text} fontFamily="IBM Plex Mono, monospace">{p.label}</text>
          )}
        </g>
      ))}
    </svg>
  );
}

function StatChip({ icon, label, value, color }) {
  return (
    <div style={{
      flex: 1, background: COLORS.panelAlt, border: `1px solid ${COLORS.border}`,
      borderRadius: 8, padding: "8px 10px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 5, color, marginBottom: 3 }}>
        {icon}
        <span className="mono" style={{ fontSize: 10, color: COLORS.textFaint }}>{label}</span>
      </div>
      <div className="mono" style={{ fontSize: 17, fontWeight: 600, color }}>{value}</div>
    </div>
  );
}

function LegendDot({ color, label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5, color: COLORS.textDim }}>
      <div style={{ width: 7, height: 7, borderRadius: 99, background: color }} />
      {label}
    </div>
  );
}

function Kpi({ icon, label, value, delta, color }) {
  return (
    <div style={{
      background: COLORS.panel, border: `1px solid ${COLORS.border}`,
      borderRadius: 12, padding: "13px 14px", display: "flex", flexDirection: "column", gap: 6,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ color, display: "flex", alignItems: "center" }}>{icon}</div>
        <span className="mono" style={{ fontSize: 10.5, color: COLORS.green }}>{delta}</span>
      </div>
      <div className="disp" style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: 11.5, color: COLORS.textFaint }}>{label}</div>
    </div>
  );
}