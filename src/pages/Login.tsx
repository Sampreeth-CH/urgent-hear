import { useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShieldAlert } from "lucide-react";

const Login = () => {
  const { user, login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (user) return <Navigate to="/dashboard" replace />;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const r = login(email, password);
    if (r.ok) nav("/dashboard");
    else setError(r.error || "Login failed");
  };

  return (
    <div className="min-h-screen grid place-items-center bg-background p-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-lg border border-border bg-card p-6 space-y-4"
      >
        <div className="flex items-center gap-2 text-destructive">
          <ShieldAlert className="h-6 w-6" />
          <h1 className="text-lg font-semibold text-foreground">
            SurakshaAI Agent Login
          </h1>
        </div>
        <p className="text-xs text-muted-foreground">
          Restricted access. Authorized agents only.
        </p>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="admin1@gmail.com"
            autoComplete="username"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>
        {error && (
          <div className="rounded border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
            {error}
          </div>
        )}
        <Button type="submit" className="w-full">
          Sign in
        </Button>
        <p className="text-[11px] text-muted-foreground">
          Demo accounts: admin1@gmail.com … admin5@gmail.com (password matches
          username).
        </p>
      </form>
    </div>
  );
};

export default Login;
