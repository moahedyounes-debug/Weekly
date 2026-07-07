import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { queryOptions, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { fetchTasksFromSheet, updateTaskInSheet, setRowStrikethroughInSheet, appendTaskToSheet, type SheetTask } from "@/lib/tasks.functions";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MultiSelect } from "@/components/ui/multi-select";
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
  queryKey: ["sheet-tasks"] as const,
  queryFn: async (): Promise<SheetTask[]> => {
    try {
      return await fetchTasksFromSheet();
    } catch (err) {
      console.error("fetchTasksFromSheet failed:", err);
      return [];
    }
  },
  staleTime: 60_000,
});

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Service Weekly KT — Task Tracker" },
      { name: "description", content: "Interactive tracker for completed, pending, and in-process tasks with team performance." },
    ],
  }),
  loader: async ({ context }) => {
    try {
      await context.queryClient.ensureQueryData(tasksQueryOptions);
    } catch (err) {
      console.error("tasks loader error:", err);
      context.queryClient.setQueryData(tasksQueryOptions.queryKey, [] as SheetTask[]);
    }
  },
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

const BUILD_ID = (import.meta.env.VITE_BUILD_ID as string | undefined) ?? "dev";
const BUILD_TIME = (import.meta.env.VITE_BUILD_TIME as string | undefined) ?? new Date().toISOString();

function BuildBadge() {
  const dt = new Date(BUILD_TIME);
  const pretty = isNaN(dt.getTime()) ? BUILD_TIME : dt.toLocaleString();
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <Badge variant="outline" className="font-mono">build {BUILD_ID}</Badge>
      <span>Last build: {pretty}</span>
    </div>
  );
}

function Dashboard() {
  const { data: initial, refetch, isFetching } = useSuspenseQuery(tasksQueryOptions);
  const queryClient = useQueryClient();
  const refreshTasks = useServerFn(fetchTasksFromSheet);
  const updateTask = useServerFn(updateTaskInSheet);
  const setStrike = useServerFn(setRowStrikethroughInSheet);
  const appendTask = useServerFn(appendTaskToSheet);
  const [tasks, setTasks] = useState<DashboardTask[]>(() => withRowKeys(initial));
  const [syncStatus, setSyncStatus] = useState<"saving" | "saved" | "error">("saved");
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [newTask, setNewTask] = useState({
    openTime: "", country: "", module: "", question: "", pic: "",
    action: "", deadline: "", completionTime: "", status: "New",
    remarks: "", sourceWeek: "",
  });
  const [savingNew, setSavingNew] = useState(false);
  useEffect(() => {
    setTasks(withRowKeys(initial));
  }, [initial]);

  const [search, setSearch] = useState("");
  const [pic, setPic] = useState<string[]>([]);
  const [module, setModule] = useState<string[]>([]);
  const [status, setStatus] = useState<string[]>([]);
  const [week, setWeek] = useState<string[]>([]);
  const [country, setCountry] = useState<string[]>([]);
  const [month, setMonth] = useState<string[]>([]);
  const [quarter, setQuarter] = useState<string[]>([]);

  const monthOf = (openTime: string | null): number | null => {
    const s = String(openTime ?? "").trim();
    if (!s) return null;
    // Try full date first (e.g. "2025-10-05", "10/5/2025")
    if (/[-/]/.test(s)) {
      const d = new Date(s);
      if (!Number.isNaN(d.getTime())) {
        const m = d.getMonth() + 1;
        if (m >= 1 && m <= 12) return m;
      }
    }
    const digits = s.replace(/\D/g, "");
    if (!digits) return null;
    // MDD format from formatOpenTimeMdd: month + zero-padded 2-digit day
    let m: number | null = null;
    if (digits.length === 3) m = Number(digits.slice(0, 1));
    else if (digits.length === 4) m = Number(digits.slice(0, 2));
    else if (digits.length === 8) m = Number(digits.slice(4, 6)); // YYYYMMDD
    return m && m >= 1 && m <= 12 ? m : null;
  };
  const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const quarterOf = (m: number | null): string | null => (m ? `Q${Math.ceil(m / 3)}` : null);

  const SLA_DAYS = 7;
  const parseDate = (v: string | null): Date | null => {
    const s = String(v ?? "").trim();
    if (!s) return null;
    if (/[-/]/.test(s)) {
      const d = new Date(s);
      if (!Number.isNaN(d.getTime())) return d;
    }
    const digits = s.replace(/\D/g, "");
    if (digits.length === 8) {
      const y = Number(digits.slice(0, 4)), m = Number(digits.slice(4, 6)), day = Number(digits.slice(6, 8));
      const d = new Date(y, m - 1, day);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    if (digits.length === 4) {
      const m = Number(digits.slice(0, 2)), day = Number(digits.slice(2, 4));
      if (m < 1 || m > 12 || day < 1 || day > 31) return null;
      const d = new Date(new Date().getFullYear(), m - 1, day);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    if (digits.length === 3) {
      const m = Number(digits.slice(0, 1)), day = Number(digits.slice(1, 3));
      if (m < 1 || m > 9 || day < 1 || day > 31) return null;
      const d = new Date(new Date().getFullYear(), m - 1, day);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    return null;
  };
  const agingOf = (t: SheetTask & { done?: boolean }): number | null => {
    const start = parseDate(t.openTime);
    if (!start) return null;
    const eff = normalizeStatus(t.status, Boolean(t.done));
    const end = eff === "Done" || eff === "Canceled" ? parseDate(t.completionTime) : null;
    const to = end && end.getTime() >= start.getTime() ? end : new Date();
    const diff = Math.floor((to.getTime() - start.getTime()) / 86400000);
    return diff >= 0 ? diff : null;
  };
  const overdueOf = (t: SheetTask & { done?: boolean }, age: number | null) => {
    const eff = normalizeStatus(t.status, Boolean(t.done));
    if (eff === "Canceled") return false;
    const deadline = parseDate(t.deadline) ?? parseDate(t.completionTime);
    if (deadline) {
      const actual = eff === "Done" ? parseDate(t.completionTime) ?? new Date() : new Date();
      return actual.getTime() > deadline.getTime();
    }
    return age !== null && age > SLA_DAYS;
  };


  const pics = useMemo(() => Array.from(new Set(initial.map((t: SheetTask) => t.pic).filter(Boolean))) as string[], [initial]);
  const modules = useMemo(() => Array.from(new Set(initial.map((t: SheetTask) => t.module).filter(Boolean))) as string[], [initial]);
  const countries = useMemo(() => Array.from(new Set(initial.map((t: SheetTask) => t.country).filter(Boolean))) as string[], [initial]);
  const weeks = useMemo(
    () => Array.from(new Set(initial.map(t => t.sourceWeek || "—").filter(Boolean))).sort() as string[],
    [initial]
  );
  const months = useMemo(() => MONTH_NAMES.slice(), []);
  const quarters = useMemo(() => ["Q1", "Q2", "Q3", "Q4"], []);



  const filtered = useMemo(() => tasks.filter(t => {
    const eff = normalizeStatus(t.status, t.done);
    if (pic.length && !pic.includes(t.pic || "")) return false;
    if (module.length && !module.includes(t.module || "")) return false;
    if (status.length && !status.includes(eff)) return false;
    if (week.length && !week.includes(t.sourceWeek || "—")) return false;
    if (country.length && !country.includes(t.country || "")) return false;
    const m = monthOf(t.openTime) ?? monthOf(t.completionTime);
    if (month.length && (!m || !month.includes(MONTH_NAMES[m - 1]))) return false;
    if (quarter.length) {
      const q = quarterOf(m);
      if (!q || !quarter.includes(q)) return false;
    }

    if (search) {
      const q = search.toLowerCase();
      const blob = `${t.question} ${t.action} ${t.remarks} ${t.description} ${t.pic} ${t.country}`.toLowerCase();
      if (!blob.includes(q)) return false;
    }
    return true;
  }), [tasks, pic, module, status, week, country, month, quarter, search]);


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

  const saveField = async (task: DashboardTask, field: "Status" | "Remarks" | "Done? (✓)" | "Question" | "Management Action", value: string) => {
    setSyncStatus("saving");
    try {
      await updateTask({
        data: {
          ...(task.rowNumber >= 2 ? { rowNumber: task.rowNumber } : {}),
          rowKey: task.rowKey,
          rowKeyIndex: task.rowKeyIndex,
          field,
          value,
        },
      });
      setSyncStatus("saved");
    } catch {
      setSyncStatus("error");
    }
  };

  const applyStrike = async (task: DashboardTask, strike: boolean) => {
    try {
      await setStrike({
        data: {
          ...(task.rowNumber >= 2 ? { rowNumber: task.rowNumber } : {}),
          rowKey: task.rowKey,
          rowKeyIndex: task.rowKeyIndex,
          strikethrough: strike,
        },
      });
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
    void applyStrike(task, done);
  };

  const setStatusFor = (task: DashboardTask, value: string) => {
    const done = value === "Done";
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: value, done } : t));
    void saveField(task, "Status", value);
    void saveField(task, "Done? (✓)", done ? "TRUE" : "FALSE");
    void applyStrike(task, done);
  };

  const setRemarksFor = (task: DashboardTask, value: string) => {
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, remarks: value } : t));
    void saveField(task, "Remarks", value);
  };

  const setQuestionFor = (task: DashboardTask, value: string) => {
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, question: value } : t));
    void saveField(task, "Question", value);
  };

  const setActionFor = (task: DashboardTask, value: string) => {
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, action: value } : t));
    void saveField(task, "Management Action", value);
  };

  const handleSync = async () => {
    setSyncStatus("saving");
    setSearch("");
    setPic([]);
    setModule([]);
    setStatus([]);
    setWeek([]);
    setCountry([]);
    setMonth([]);
    setQuarter([]);

    try {
      const freshTasks = await refreshTasks({ data: { forceRefresh: true } });
      queryClient.setQueryData(tasksQueryOptions.queryKey, freshTasks);
      setTasks(withRowKeys(freshTasks));
      setSyncStatus("saved");
    } catch (error) {
      console.error("Sync Sheet failed:", error);
      setSyncStatus("error");
      void refetch();
    }
  };

  const submitNewTask = async () => {
    if (!newTask.question.trim()) return;
    setSavingNew(true);
    setSyncStatus("saving");
    try {
      await appendTask({ data: newTask });
      const freshTasks = await refreshTasks({ data: { forceRefresh: true } });
      queryClient.setQueryData(tasksQueryOptions.queryKey, freshTasks);
      setTasks(withRowKeys(freshTasks));
      setSyncStatus("saved");
      setNewTaskOpen(false);
      setNewTask({
        openTime: "", country: "", module: "", question: "", pic: "",
        action: "", deadline: "", completionTime: "", status: "New",
        remarks: "", sourceWeek: "",
      });
    } catch (error) {
      console.error("Add task failed:", error);
      setSyncStatus("error");
    } finally {
      setSavingNew(false);
    }
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
            <Button variant="outline" onClick={handleSync} disabled={isFetching || syncStatus === "saving"}>
              <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} /> Sync Sheet
            </Button>
            <Button asChild>
              <a href="/Service_KT_Interactive_Dashboard.xlsx" download>
                <Download className="h-4 w-4 mr-2" /> Download Excel
              </a>
            </Button>
          </div>
        </header>

        <BuildBadge />


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
          <CardContent className="pt-6 grid gap-3 grid-cols-1 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-8">
            <Input className="md:col-span-4 xl:col-span-8" placeholder="Search task, action, remarks, country..." value={search} onChange={e => setSearch(e.target.value)} />
            <MultiSelect options={pics} selected={pic} onChange={setPic} placeholder="All PICs" />
            <MultiSelect options={modules} selected={module} onChange={setModule} placeholder="All Modules" />
            <MultiSelect options={["Done", "In process", "New", "Canceled"]} selected={status} onChange={setStatus} placeholder="All Status" />
            <MultiSelect options={weeks} selected={week} onChange={setWeek} placeholder="All Weeks" />
            <MultiSelect options={months} selected={month} onChange={setMonth} placeholder="All Months" />
            <MultiSelect options={quarters} selected={quarter} onChange={setQuarter} placeholder="All Quarters" />
            <MultiSelect options={countries} selected={country} onChange={setCountry} placeholder="All Countries" />
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
                      <TableHead className="text-center">Canceled</TableHead>
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
                        <TableCell className="text-center"><Badge style={{ background: STATUS_COLORS.Canceled, color: "white" }}>{w.Canceled}</Badge></TableCell>
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
              <CardHeader className="flex flex-row items-center justify-between gap-3">
                <CardTitle>Task Tracker — set status inline</CardTitle>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setStatus(["Canceled"])}>Canceled</Button>
                  <Button size="sm" onClick={() => setNewTaskOpen(true)}>
                    <Plus className="h-4 w-4 mr-1" /> New Task
                  </Button>
                  <Badge
                    variant={syncStatus === "error" ? "destructive" : "secondary"}
                    className={
                      syncStatus === "saving"
                        ? "bg-amber-500 text-white hover:bg-amber-500"
                        : syncStatus === "error"
                        ? ""
                        : "bg-emerald-600 text-white hover:bg-emerald-600"
                    }
                  >
                    <span
                      className={`mr-1.5 inline-block h-2 w-2 rounded-full bg-white ${
                        syncStatus === "saving" ? "animate-pulse" : ""
                      }`}
                    />
                    {syncStatus === "saving"
                      ? "Saving…"
                      : syncStatus === "error"
                      ? "Save failed"
                      : "Saved ✓"}
                  </Badge>
                </div>
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
                      <TableHead>Aging</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Remarks</TableHead>
                      <TableHead>Country</TableHead>
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
                          <TableCell className="min-w-64 max-w-xs">
                            <Textarea
                              value={t.question || ""}
                              onChange={(e) => setTasks(prev => prev.map(row => row.id === t.id ? { ...row, question: e.target.value } : row))}
                              onBlur={(e) => setQuestionFor(t, e.target.value)}
                              className={`min-h-9 text-sm ${t.done ? "line-through" : ""}`}
                            />
                          </TableCell>
                          <TableCell>{t.pic}</TableCell>
                          <TableCell className="min-w-64 max-w-sm">
                            <Textarea
                              value={t.action || ""}
                              onChange={(e) => setTasks(prev => prev.map(row => row.id === t.id ? { ...row, action: e.target.value } : row))}
                              onBlur={(e) => setActionFor(t, e.target.value)}
                              className="min-h-9 text-sm text-muted-foreground"
                            />
                          </TableCell>
                          {(() => {
                            const age = agingOf(t);
                            const overdue = overdueOf(t, age);
                            return (
                              <TableCell>
                                {age === null ? (
                                  <span className="text-muted-foreground">—</span>
                                ) : (
                                  <Badge
                                    className={
                                      overdue
                                        ? "bg-red-600 text-white hover:bg-red-600 animate-pulse"
                                        : "bg-emerald-600 text-white hover:bg-emerald-600"
                                    }
                                  >
                                    {age}d
                                  </Badge>
                                )}
                              </TableCell>
                            );
                          })()}
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
                          <TableCell className="min-w-64">
                            <Textarea
                              value={t.remarks || ""}
                              onChange={(e) => setTasks(prev => prev.map(row => row.id === t.id ? { ...row, remarks: e.target.value } : row))}
                              onBlur={(e) => setRemarksFor(t, e.target.value)}
                              className="min-h-9 text-sm"
                            />
                          </TableCell>
                          <TableCell>{t.country || "—"}</TableCell>
                          <TableCell>{t.sourceWeek}</TableCell>
                        </TableRow>
                      );
                    })}
                    {filtered.length === 0 && (
                      <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">No tasks match the filters.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={newTaskOpen} onOpenChange={setNewTaskOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Add New Task</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><Label>Open Time</Label><Input value={newTask.openTime} onChange={e => setNewTask(v => ({ ...v, openTime: e.target.value }))} placeholder="e.g. 707" /></div>
            <div><Label>Country</Label><Input value={newTask.country} onChange={e => setNewTask(v => ({ ...v, country: e.target.value }))} placeholder="e.g. KSA" /></div>
            <div><Label>Module</Label><Input value={newTask.module} onChange={e => setNewTask(v => ({ ...v, module: e.target.value }))} placeholder="e.g. SP, IT, SN" /></div>
            <div><Label>PIC</Label><Input value={newTask.pic} onChange={e => setNewTask(v => ({ ...v, pic: e.target.value }))} /></div>
            <div className="sm:col-span-2"><Label>Question / Task</Label><Textarea value={newTask.question} onChange={e => setNewTask(v => ({ ...v, question: e.target.value }))} rows={2} /></div>
            <div className="sm:col-span-2"><Label>Management Action</Label><Textarea value={newTask.action} onChange={e => setNewTask(v => ({ ...v, action: e.target.value }))} rows={2} /></div>
            <div><Label>Deadline</Label><Input value={newTask.deadline} onChange={e => setNewTask(v => ({ ...v, deadline: e.target.value }))} placeholder="e.g. 2026-07-30 or Monthly" /></div>
            <div><Label>Completion Time</Label><Input value={newTask.completionTime} onChange={e => setNewTask(v => ({ ...v, completionTime: e.target.value }))} /></div>
            <div>
              <Label>Status</Label>
              <Select value={newTask.status} onValueChange={v => setNewTask(s => ({ ...s, status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="New">New</SelectItem>
                  <SelectItem value="In process">In process</SelectItem>
                  <SelectItem value="Done">Done</SelectItem>
                  <SelectItem value="Canceled">Canceled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Source Week</Label><Input value={newTask.sourceWeek} onChange={e => setNewTask(v => ({ ...v, sourceWeek: e.target.value }))} placeholder="e.g. W23" /></div>
            <div className="sm:col-span-2"><Label>Remarks</Label><Textarea value={newTask.remarks} onChange={e => setNewTask(v => ({ ...v, remarks: e.target.value }))} rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewTaskOpen(false)} disabled={savingNew}>Cancel</Button>
            <Button onClick={submitNewTask} disabled={savingNew || !newTask.question.trim()}>
              {savingNew ? "Saving…" : "Save Task"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
