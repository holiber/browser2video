/** @description Main app page with form, scroll area, drag-and-drop, node graph, and drawing sections */
import { useState, useRef, useCallback, useEffect, useMemo, type PointerEvent } from "react";
import { motion, Reorder } from "framer-motion";
import { GripVertical, Pencil, Square, Circle, Database, Zap, Monitor } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent } from "@/components/ui/card";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  addEdge,
  type Connection,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

/* ------------------------------------------------------------------ */
/*  Section wrapper with Framer Motion entry animation                */
/* ------------------------------------------------------------------ */
function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <motion.section
      id={id}
      data-testid={`section-${id}`}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-4"
    >
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      {children}
    </motion.section>
  );
}

/* ------------------------------------------------------------------ */
/*  Demo Form                                                         */
/* ------------------------------------------------------------------ */
function DemoForm() {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    notifications: false,
    preferences: { updates: false, marketing: false, analytics: false },
  });

  return (
    <Section id="form" title="Demo Form">
      <Card>
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-2">
          {/* Name */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="form-name">Full Name</Label>
            <Input
              id="form-name"
              placeholder="Jane Doe"
              value={formData.name}
              onChange={(e) =>
                setFormData((d) => ({ ...d, name: e.target.value }))
              }
              data-testid="form-name"
            />
          </div>

          {/* Email */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="form-email">Email</Label>
            <Input
              id="form-email"
              type="email"
              placeholder="jane@example.com"
              value={formData.email}
              onChange={(e) =>
                setFormData((d) => ({ ...d, email: e.target.value }))
              }
              data-testid="form-email"
            />
          </div>

          {/* Checkboxes */}
          <div className="flex flex-col gap-3 sm:col-span-2">
            <Label>Preferences</Label>
            <div className="flex flex-wrap gap-4">
              {(["updates", "marketing", "analytics"] as const).map((key) => (
                <label
                  key={key}
                  className="flex items-center gap-2 text-sm"
                >
                  <Checkbox
                    checked={formData.preferences[key]}
                    onCheckedChange={(c) =>
                      setFormData((d) => ({
                        ...d,
                        preferences: { ...d.preferences, [key]: !!c },
                      }))
                    }
                    data-testid={`form-pref-${key}`}
                  />
                  {key.charAt(0).toUpperCase() + key.slice(1)}
                </label>
              ))}
            </div>
          </div>

          {/* Switch */}
          <div className="flex items-center gap-3 sm:col-span-2">
            <Switch
              checked={formData.notifications}
              onCheckedChange={(c) =>
                setFormData((d) => ({ ...d, notifications: c }))
              }
              data-testid="form-notifications"
            />
            <Label>Enable notifications</Label>
          </div>
        </CardContent>
      </Card>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/*  Scrollable Area                                                   */
/* ------------------------------------------------------------------ */
function ScrollableArea() {
  const items = Array.from({ length: 60 }, (_, i) => `Item #${i + 1}`);

  return (
    <Section id="scroll" title="Scrollable Area">
      <Card>
        <CardContent className="pt-6">
          <ScrollArea className="h-64 rounded-md border" data-testid="scroll-area">
            <div className="p-4">
              {items.map((item, i) => (
                <div key={i}>
                  <div className="py-2 text-sm" data-testid={`scroll-item-${i}`}>
                    {item} — Lorem ipsum dolor sit amet consectetur adipisicing.
                  </div>
                  {i < items.length - 1 && <Separator />}
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/*  Drag & Drop (Framer Motion Reorder)                               */
/* ------------------------------------------------------------------ */
const INITIAL_DRAG_ITEMS = [
  { id: "task-1", label: "Design mockups" },
  { id: "task-2", label: "Set up CI/CD" },
  { id: "task-3", label: "Write unit tests" },
  { id: "task-4", label: "Deploy to staging" },
  { id: "task-5", label: "Code review" },
];

function DragAndDrop() {
  const [items, setItems] = useState(INITIAL_DRAG_ITEMS);

  return (
    <Section id="drag" title="Drag & Drop">
      <Card>
        <CardContent className="pt-6">
          <p className="mb-3 text-sm text-muted-foreground">
            Drag items to reorder the list.
          </p>
          <Reorder.Group
            axis="y"
            values={items}
            onReorder={setItems}
            className="space-y-2"
            data-testid="drag-list"
          >
            {items.map((item) => (
              <Reorder.Item
                key={item.id}
                value={item}
                className="flex cursor-grab items-center gap-3 rounded-md border bg-card p-3 active:cursor-grabbing"
                data-testid={`drag-item-${item.id}`}
                whileDrag={{ scale: 1.03, boxShadow: "0 4px 16px rgba(0,0,0,0.12)" }}
              >
                <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="text-sm">{item.label}</span>
              </Reorder.Item>
            ))}
          </Reorder.Group>
        </CardContent>
      </Card>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/*  Node Graph (React Flow)                                           */
/* ------------------------------------------------------------------ */

// Custom node component — must be declared outside the parent component
// so that nodeTypes object reference stays stable across renders.
function FlowNode({ data }: NodeProps) {
  const icon =
    data.icon === "database" ? <Database className="h-4 w-4 text-blue-400" /> :
    data.icon === "zap" ? <Zap className="h-4 w-4 text-yellow-400" /> :
    data.icon === "monitor" ? <Monitor className="h-4 w-4 text-green-400" /> :
    null;

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 shadow-md min-w-[130px]">
      <Handle
        type="target"
        position={Position.Left}
        style={{ width: 14, height: 14, background: "#60a5fa", border: "2px solid #1e293b" }}
      />
      {icon}
      <span className="text-sm font-medium">{data.label as string}</span>
      <Handle
        type="source"
        position={Position.Right}
        style={{ width: 14, height: 14, background: "#60a5fa", border: "2px solid #1e293b" }}
      />
    </div>
  );
}

const FLOW_NODE_TYPES: NodeTypes = { custom: FlowNode };

const INITIAL_FLOW_NODES = [
  {
    id: "source",
    type: "custom" as const,
    position: { x: 40, y: 40 },
    data: { label: "Data Source", icon: "database" },
  },
  {
    id: "transform",
    type: "custom" as const,
    position: { x: 310, y: 120 },
    data: { label: "Transform", icon: "zap" },
  },
  {
    id: "output",
    type: "custom" as const,
    position: { x: 580, y: 40 },
    data: { label: "Output", icon: "monitor" },
  },
];

function NodeGraph() {
  const [nodes, , onNodesChange] = useNodesState(INITIAL_FLOW_NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) =>
        addEdge(
          { ...connection, animated: true, style: { stroke: "#60a5fa", strokeWidth: 2 } },
          eds,
        ),
      );
    },
    [setEdges],
  );

  // Stable reference — must not change between renders
  const nodeTypes = useMemo(() => FLOW_NODE_TYPES, []);

  return (
    <Section id="flow" title="Node Graph">
      <Card>
        <CardContent className="pt-6">
          <p className="mb-3 text-sm text-muted-foreground">
            Connect nodes by dragging between handles. Drag nodes to reposition.
          </p>
          <div className="h-80 rounded-md border overflow-hidden" data-testid="flow-container">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              nodeTypes={nodeTypes}
              colorMode="dark"
              fitView
              fitViewOptions={{ padding: 0.3 }}
            >
              <Background />
              <Controls />
            </ReactFlow>
          </div>
        </CardContent>
      </Card>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/*  Drawing Canvas                                                    */
/* ------------------------------------------------------------------ */
type DrawTool = "freehand" | "rectangle" | "circle";

interface Shape {
  tool: DrawTool;
  points?: { x: number; y: number }[];
  start?: { x: number; y: number };
  end?: { x: number; y: number };
}

function DrawingCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<DrawTool>("freehand");
  const [shapes, setShapes] = useState<Shape[]>([]);
  const drawing = useRef(false);
  const currentShape = useRef<Shape | null>(null);

  const getPos = useCallback(
    (e: PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      // Scale display coordinates to canvas internal coordinates
      return {
        x: (e.clientX - rect.left) * (canvas.width / rect.width),
        y: (e.clientY - rect.top) * (canvas.height / rect.height),
      };
    },
    [],
  );

  const redraw = useCallback(
    (extra?: Shape) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const all = extra ? [...shapes, extra] : shapes;
      for (const shape of all) {
        ctx.strokeStyle = "#60a5fa";
        ctx.lineWidth = 2;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        if (shape.tool === "freehand" && shape.points && shape.points.length > 1) {
          ctx.beginPath();
          ctx.moveTo(shape.points[0].x, shape.points[0].y);
          for (let i = 1; i < shape.points.length; i++) {
            ctx.lineTo(shape.points[i].x, shape.points[i].y);
          }
          ctx.stroke();
        } else if (shape.tool === "rectangle" && shape.start && shape.end) {
          ctx.strokeRect(
            shape.start.x,
            shape.start.y,
            shape.end.x - shape.start.x,
            shape.end.y - shape.start.y,
          );
        } else if (shape.tool === "circle" && shape.start && shape.end) {
          const rx = (shape.end.x - shape.start.x) / 2;
          const ry = (shape.end.y - shape.start.y) / 2;
          const cx = shape.start.x + rx;
          const cy = shape.start.y + ry;
          ctx.beginPath();
          ctx.ellipse(cx, cy, Math.abs(rx), Math.abs(ry), 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    },
    [shapes],
  );

  useEffect(() => {
    redraw();
  }, [redraw]);

  function handlePointerDown(e: PointerEvent<HTMLCanvasElement>) {
    drawing.current = true;
    const pos = getPos(e);
    if (tool === "freehand") {
      currentShape.current = { tool, points: [pos] };
    } else {
      currentShape.current = { tool, start: pos, end: pos };
    }
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || !currentShape.current) return;
    const pos = getPos(e);
    if (tool === "freehand") {
      currentShape.current.points!.push(pos);
    } else {
      currentShape.current.end = pos;
    }
    redraw(currentShape.current);
  }

  function handlePointerUp() {
    if (!drawing.current) return;
    drawing.current = false;
    if (currentShape.current) {
      const shape = currentShape.current;
      currentShape.current = null;
      setShapes((prev) => [...prev, shape]);
    }
  }

  return (
    <Section id="draw" title="Drawing Canvas">
      <Card>
        <CardContent className="pt-6">
          <div className="mb-3 flex gap-2">
            {(
              [
                { t: "freehand", icon: Pencil, label: "Freehand" },
                { t: "rectangle", icon: Square, label: "Rectangle" },
                { t: "circle", icon: Circle, label: "Circle" },
              ] as const
            ).map(({ t, icon: Icon, label }) => (
              <Button
                key={t}
                variant={tool === t ? "default" : "outline"}
                size="sm"
                className="gap-1.5"
                onClick={() => setTool(t)}
                data-testid={`draw-tool-${t}`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </Button>
            ))}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShapes([])}
              data-testid="draw-clear"
            >
              Clear
            </Button>
          </div>
          <canvas
            ref={canvasRef}
            width={600}
            height={300}
            className="w-full rounded-md border bg-neutral-900"
            style={{ touchAction: "none" }}
            data-testid="draw-canvas"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          />
        </CardContent>
      </Card>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/*  Page export                                                       */
/* ------------------------------------------------------------------ */
export default function AppPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-8 p-6" data-testid="app-page">
      <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
      <DemoForm />
      <ScrollableArea />
      <DragAndDrop />
      <NodeGraph />
      <DrawingCanvas />
    </div>
  );
}
