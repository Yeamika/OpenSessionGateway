export type RuntimeTimerRow = {
  id: string;
  runtime_id: string;
  session_id: string;
  title: string;
  message: string;
  delay_ms: number;
  created_at: Date;
  trigger_at: Date;
  triggered_at: Date | null;
  status: "pending" | "triggered" | "cancelled";
  timeout_ref: NodeJS.Timeout | null;
};
