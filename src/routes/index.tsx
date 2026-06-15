import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { fetchTasksFromSheet, updateTaskInSheet, type SheetTask } from "@/lib/tasks.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  LineChart, Line,
} from "recharts";
import { CheckCircle2, Clock, Sparkles, ListTodo, Download, TrendingUp, RefreshCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

const tasksQueryOptions = queryOptions({
  queryKey: ["sheet-tasks"],
  queryFn: () => fetchTasksFromSheet(),
  staleTime: 60_000,
});

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Service Weekly KT — Task Tracker" },
      { name: "description", content: "Interactive tracker for completed, pending, and in-process tasks with team performance." },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(tasksQueryOptions),
  errorComponent: ({ error }) => (
    <div className="p-8 text-destructive">Failed to load sheet: {error.message}</div>
  ),
  component: Dashboard,
});

function normalizeText(value: unknown) {
  const normalized = String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  return normalized === "—" || normalized === "-" ? "" : normalized;
}

function taskKey(task: SheetTask) {
  return [task.openTime, task.module, task.question, task.pic, task.action, task.completionTime, task.sourceWeek]
    .map(normalizeText)
    .join("||");
}

function normalizeStatusValue(s: string | null): string {
  const value = normalizeText(s);
  if (value === "done" || value === "completed" || value === "complete") return "Done";
  if (value.startsWith("in") || value === "process" || value === "ongoing") return "In process";
  if (value === "new" || value === "pending" || value === "open") return "New";
  if (value === "canceled" || value === "cancelled" || value === "cancel" || value === "ملغي" || value === "ملغية") return "Canceled";
  return s?.trim() || "New";
}

function normalizeStatus(s: string | null, done: boolean): string {
  if (done) return "Done";
  return normalizeStatusValue(s);
}

const STATUS_COLORS: Record<string, string> = {
  Done: "hsl(142 71% 45%)",
  "In process": "hsl(38 92% 50%)",
  New: "hsl(217 91% 60%)",
  Canceled: "hsl(215 16% 47%)",
};

type DashboardTask = SheetTask & { id: number; rowKey: string; rowKeyIndex: number };

function withRowKeys(rows: SheetTask[]): DashboardTask[] {
  const seen = new Map<string, number>();
  return rows.map((task, id) => {
    const key = taskKey(task);
    const rowKeyIndex = seen.get(key) ?? 0;
    seen.set(key, rowKeyIndex + 1);
    return { ...task, id, rowKey: key, rowKeyIndex };
  });
}

function Dashboard() {
  const { data: initial, refetch, isFetching } = useSuspenseQuery(tasksQueryOptions);
  const updateTask = useServerFn(updateTaskInSheet);
  const [tasks, setTasks] = useState<DashboardTask[]>(() => withRowKeys(initial));
  const [syncStatus, setSyncStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  useEffect(() => {
    setTasks(withRowKeys(initial));
  }, [initial]);

  const [search, setSearch] = useState("");
  const [pic, setPic] = useState<string>("all");
  const [module, setModule] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [week, setWeek] = useState<string>("all");

  const pics = useMemo(() => Array.from(new Set(initial.map((t: SheetTask) => t.pic).filter(Boolean))) as string[], [initial]);
  const modules = useMemo(() => Array.from(new Set(initial.map((t: SheetTask) => t.module).filter(Boolean))) as string[], [initial]);
  const weeks = useMemo(
    () => Array.from(new Set(initial.map(t => t.sourceWeek || "—").filter(Boolean))).sort() as string[],
    [initial]
  );

  const filtered = useMemo(() => tasks.filter(t => {
    const eff = normalizeStatus(t.status, t.done);
    if (pic !== "all" && t.pic !== pic) return false;
    if (module !== "all" && t.module !== module) return false;
    if (status !== "all" && eff !== status) return false;
    if (week !== "all" && (t.sourceWeek || "—") !== week) return false;
    if (search) {
      const q = search.toLowerCase();
      const blob = `${t.question} ${t.action} ${t.remarks} ${t.description} ${t.pic}`.toLowerCase();
      if (!blob.includes(q)) return false;
    }
    return true;
  }), [tasks, pic, module, status, week, search]);

  const stats = useMemo(() => {
    const total = filtered.length;
    const done = filtered.filter(t => normalizeStatus(t.status, t.done) === "Done").length;
    const inProc = filtered.filter(t => normalizeStatus(t.status, t.done) === "In process").length;
    const news = filtered.filter(t => normalizeStatus(t.status, t.done) === "New").length;
    const canceled = filtered.filter(t => normalizeStatus(t.status, t.done) === "Canceled").length;
    return { total, done, inProc, news, canceled, pct: total ? Math.round((done / total) * 100) : 0 };
  }, [filtered]);

  const statusData = [
    { name: "Done", value: stats.done },
    { name: "In process", value: stats.inProc },
    { name: "New", value: stats.news },
    { name: "Canceled", value: stats.canceled },
  ].filter(d => d.value > 0);

  const perfData = useMemo(() => {
    const map = new Map<string, { name: string; Done: number; "In process": number; New: number; Canceled: number; Total: number }>();
    filtered.forEach(t => {
      const p = t.pic || "Unassigned";
      const eff = normalizeStatus(t.status, t.done) as "Done" | "In process" | "New" | "Canceled";
      if (!map.has(p)) map.set(p, { name: p, Done: 0, "In process": 0, New: 0, Canceled: 0, Total: 0 });
      const m = map.get(p)!;
      m[eff] += 1;
      m.Total += 1;
    });
    return Array.from(map.values()).map(m => ({
      ...m,
      Completion: m.Total ? Math.round((m.Done / m.Total) * 100) : 0,
    })).sort((a, b) => b.Completion - a.Completion);
  }, [filtered]);

  const moduleData = useMemo(() => {
    const map = new Map<string, { name: string; Done: number; Open: number; Canceled: number }>();
    filtered.forEach(t => {
      const m = t.module || "—";
      const eff = normalizeStatus(t.status, t.done);
      if (!map.has(m)) map.set(m, { name: m, Done: 0, Open: 0, Canceled: 0 });
      const e = map.get(m)!;
      if (eff === "Done") e.Done++;
      else if (eff === "Canceled") e.Canceled++;
      else e.Open++;
    });
    return Array.from(map.values());
  }, [filtered]);

  const weeklyTrend = useMemo(() => {
    return weeks.map(w => {
      const wt = filtered.filter(t => (t.sourceWeek || "—") === w);
      const done = wt.filter(t => normalizeStatus(t.status, t.done) === "Done").length;
      const inProc = wt.filter(t => normalizeStatus(t.status, t.done) === "In process").length;
      const news = wt.filter(t => normalizeStatus(t.status, t.done) === "New").length;
      const canceled = wt.filter(t => normalizeStatus(t.status, t.done) === "Canceled").length;
      return {
        week: w,
        Done: done,
        "In process": inProc,
        New: news,
        Canceled: canceled,
        Total: wt.length,
        Completion: wt.length ? Math.round((done / wt.length) * 100) : 0,
      };
    });
  }, [filtered, weeks]);

  const weeklyByPic = useMemo(() => {
    // [{ week, [pic]: completion% }, ...]
    return weeks.map(w => {
      const row: Record<string, string | number> = { week: w };
      pics.forEach(p => {
        const wt = filtered.filter(t => (t.sourceWeek || "—") === w && t.pic === p);
        const done = wt.filter(t => normalizeStatus(t.status, t.done) === "Done").length;
        row[p] = wt.length ? Math.round((done / wt.length) * 100) : 0;
      });
      return row;
    });
  }, [filtered, weeks, pics]);

  const saveField = async (task: DashboardTask, field: "Status" | "Remarks" | "Done? (✓)", value: string) => {
    setSyncStatus("saving");
    try {
      await updateTask({ data: { rowKey: task.rowKey, rowKeyIndex: task.rowKeyIndex, field, value } });
      setSyncStatus("saved");
      window.setTimeout(() => setSyncStatus("idle"), 1500);
    } catch {
      setSyncStatus("error");
    }
  };

  const toggleDone = (task: DashboardTask) => {
    const done = !task.done;
    const nextStatus = done ? "Done" : "In process";
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, done, status: nextStatus } : t));
    void saveField(task, "Done? (✓)", done ? "TRUE" : "FALSE");
    void saveField(task, "Status", nextStatus);
  };

  const setStatusFor = (task: DashboardTask, value: string) => {
    const done = value === "Done";
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: value, done } : t));
    void saveField(task, "Status", value);
    void saveField(task, "Done? (✓)", done ? "TRUE" : "FALSE");
  };

  const setRemarksFor = (task: DashboardTask, value: string) => {
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, remarks: value } : t));
    void saveField(task, "Remarks", value);
  };

  const picColors = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6"];

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Service Weekly KT Tracker</h1>
            <p className="text-muted-foreground">
              Interactive dashboard for task status, completion, and team performance.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} /> Sync Sheet
            </Button>
            <Button asChild>
              <a href="/Service_KT_Interactive_Dashboard.xlsx" download>
                <Download className="h-4 w-4 mr-2" /> Download Excel
              </a>
            </Button>
          </div>
        </header>

        {/* KPI cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <KpiCard icon={<ListTodo className="h-5 w-5" />} label="Total Tasks" value={stats.total} tone="muted" />
          <KpiCard icon={<CheckCircle2 className="h-5 w-5" />} label="Completed" value={stats.done} tone="success" />
          <KpiCard icon={<Clock className="h-5 w-5" />} label="In Process" value={stats.inProc} tone="warning" />
          <KpiCard icon={<Sparkles className="h-5 w-5" />} label="New" value={stats.news} tone="info" />
          <KpiCard icon={<XCircle className="h-5 w-5" />} label="Canceled" value={stats.canceled} tone="muted" />
        </div>

        {/* Completion progress */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Overall Completion</span>
              <span className="text-2xl font-bold text-primary">{stats.pct}%</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Progress value={stats.pct} className="h-3" />
            <p className="mt-2 text-sm text-muted-foreground">
              {stats.done} of {stats.total} tasks completed
            </p>
          </CardContent>
        </Card>

        {/* Filters */}
        <Card>
          <CardContent className="pt-6 grid gap-3 md:grid-cols-5">
            <Input placeholder="Search task, action, remarks..." value={search} onChange={e => setSearch(e.target.value)} />
            <Select value={pic} onValueChange={setPic}>
              <SelectTrigger><SelectValue placeholder="PIC" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All PICs</SelectItem>
                {pics.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={module} onValueChange={setModule}>
              <SelectTrigger><SelectValue placeholder="Module" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Modules</SelectItem>
                {modules.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="Done">Done</SelectItem>
                <SelectItem value="In process">In Process</SelectItem>
                <SelectItem value="New">New</SelectItem>
                <SelectItem value="Canceled">Canceled</SelectItem>
              </SelectContent>
            </Select>
            <Select value={week} onValueChange={setWeek}>
              <SelectTrigger><SelectValue placeholder="Week" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Weeks</SelectItem>
                {weeks.map(w => <SelectItem key={w} value={w}>{w}</SelectItem>)}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="performance">Team Performance</TabsTrigger>
            <TabsTrigger value="trends">Weekly Trends</TabsTrigger>
            <TabsTrigger value="tasks">Task Tracker</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Status Distribution</CardTitle></CardHeader>
              <CardContent style={{ height: 320 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={statusData} dataKey="value" nameKey="name" outerRadius={110} label>
                      {statusData.map((d) => (
                        <Cell key={d.name} fill={STATUS_COLORS[d.name]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Tasks by Module</CardTitle></CardHeader>
              <CardContent style={{ height: 320 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={moduleData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="Done" stackId="a" fill={STATUS_COLORS.Done} />
                    <Bar dataKey="Open" stackId="a" fill={STATUS_COLORS["In process"]} />
                      <Bar dataKey="Canceled" stackId="a" fill={STATUS_COLORS.Canceled} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="performance" className="space-y-4">
            <Card>
              <CardHeader><CardTitle>Employee Completion %</CardTitle></CardHeader>
              <CardContent style={{ height: 340 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={perfData} layout="vertical" margin={{ left: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" domain={[0, 100]} unit="%" />
                    <YAxis dataKey="name" type="category" />
                    <Tooltip />
                    <Bar dataKey="Completion" fill="hsl(217 91% 60%)" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {perfData.map(p => (
                <Card key={p.name}>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center justify-between text-base">
                      <span>{p.name}</span>
                      <Badge variant="secondary">{p.Completion}%</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <Progress value={p.Completion} className="h-2" />
                    <div className="flex flex-wrap gap-2 text-xs">
                      <Badge style={{ background: STATUS_COLORS.Done, color: "white" }}>Done {p.Done}</Badge>
                      <Badge style={{ background: STATUS_COLORS["In process"], color: "white" }}>In Process {p["In process"]}</Badge>
                      <Badge style={{ background: STATUS_COLORS.New, color: "white" }}>New {p.New}</Badge>
                      <Badge style={{ background: STATUS_COLORS.Canceled, color: "white" }}>Canceled {p.Canceled}</Badge>
                      <Badge variant="outline">Total {p.Total}</Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="trends" className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5" /> Completion % Trend
                  </CardTitle>
                </CardHeader>
                <CardContent style={{ height: 320 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={weeklyTrend}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="week" />
                      <YAxis domain={[0, 100]} unit="%" />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="Completion" stroke="hsl(217 91% 60%)" strokeWidth={3} dot={{ r: 5 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>Status Mix by Week</CardTitle></CardHeader>
                <CardContent style={{ height: 320 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={weeklyTrend}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="week" />
                      <YAxis allowDecimals={false} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="Done" stackId="a" fill={STATUS_COLORS.Done} />
                      <Bar dataKey="In process" stackId="a" fill={STATUS_COLORS["In process"]} />
                      <Bar dataKey="New" stackId="a" fill={STATUS_COLORS.New} />
                      <Bar dataKey="Canceled" stackId="a" fill={STATUS_COLORS.Canceled} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>
            <Card>
              <CardHeader><CardTitle>Employee Completion % by Week</CardTitle></CardHeader>
              <CardContent style={{ height: 360 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={weeklyByPic}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="week" />
                    <YAxis domain={[0, 100]} unit="%" />
                    <Tooltip />
                    <Legend />
                    {pics.map((p, i) => (
                      <Line key={p} type="monotone" dataKey={p} stroke={picColors[i % picColors.length]} strokeWidth={2} dot={{ r: 4 }} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Weekly Summary</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Week</TableHead>
                      <TableHead className="text-center">Total</TableHead>
                      <TableHead className="text-center">Done</TableHead>
                      <TableHead className="text-center">In Process</TableHead>
                      <TableHead className="text-center">New</TableHead>
                      <TableHead>Completion</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {weeklyTrend.map(w => (
                      <TableRow key={w.week}>
                        <TableCell className="font-semibold">{w.week}</TableCell>
                        <TableCell className="text-center">{w.Total}</TableCell>
                        <TableCell className="text-center"><Badge style={{ background: STATUS_COLORS.Done, color: "white" }}>{w.Done}</Badge></TableCell>
                        <TableCell className="text-center"><Badge style={{ background: STATUS_COLORS["In process"], color: "white" }}>{w["In process"]}</Badge></TableCell>
                        <TableCell className="text-center"><Badge style={{ background: STATUS_COLORS.New, color: "white" }}>{w.New}</Badge></TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Progress value={w.Completion} className="h-2 w-32" />
                            <span className="text-sm font-medium">{w.Completion}%</span>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="tasks">
            <Card>
              <CardHeader>
                <CardTitle>Task Tracker — set status inline</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10"></TableHead>
                      <TableHead>Module</TableHead>
                      <TableHead>Task</TableHead>
                      <TableHead>PIC</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Week</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map(t => {
                      const eff = normalizeStatus(t.status, t.done);
                      return (
                        <TableRow key={t.id} className={t.done ? "opacity-60" : ""}>
                          <TableCell>
                            <Checkbox checked={t.done} onCheckedChange={() => toggleDone(t)} />
                          </TableCell>
                          <TableCell><Badge variant="outline">{t.module || "—"}</Badge></TableCell>
                          <TableCell className={`max-w-xs ${t.done ? "line-through" : ""}`}>{t.question}</TableCell>
                          <TableCell>{t.pic}</TableCell>
                          <TableCell className="max-w-sm text-sm text-muted-foreground">{t.action}</TableCell>
                          <TableCell>
                            <Select value={eff} onValueChange={(v) => setStatusFor(t, v)}>
                              <SelectTrigger
                                className="h-8 w-32 border-0 font-medium text-white"
                                style={{ background: STATUS_COLORS[eff] }}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="Done">Done</SelectItem>
                                <SelectItem value="In process">In Process</SelectItem>
                                <SelectItem value="New">New</SelectItem>
                                <SelectItem value="Canceled">Canceled</SelectItem>
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>{t.sourceWeek}</TableCell>
                        </TableRow>
                      );
                    })}
                    {filtered.length === 0 && (
                      <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No tasks match the filters.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function KpiCard({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: "muted" | "success" | "warning" | "info" }) {
  const toneCls = {
    muted: "bg-muted text-foreground",
    success: "bg-green-500/10 text-green-600 dark:text-green-400",
    warning: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    info: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  }[tone];
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-3xl font-bold mt-1">{value}</p>
          </div>
          <div className={`p-3 rounded-lg ${toneCls}`}>{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}
