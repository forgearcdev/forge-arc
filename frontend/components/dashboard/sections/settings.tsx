"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Wallet,
  Bell,
  Shield,
  Palette,
  Link2,
  Globe,
  Key,
  RefreshCw,
  Check,
  ExternalLink,
  Zap,
  Coins,
  Bot,
  AlertTriangle,
  Copy,
} from "lucide-react";

const integrations = [
  {
    id: "arc",
    name: "Arc Blockchain",
    description: "Primary network for transactions",
    connected: true,
    network: "Testnet",
  },
  {
    id: "usdc",
    name: "USDC",
    description: "Stablecoin for payments",
    connected: true,
    balance: "1,247",
  },
  {
    id: "openai",
    name: "OpenAI API",
    description: "Agent inference provider",
    connected: true,
    status: "Active",
  },
  {
    id: "anthropic",
    name: "Anthropic API",
    description: "Alternative inference provider",
    connected: false,
    status: null,
  },
  {
    id: "github",
    name: "GitHub",
    description: "Code repository access for agents",
    connected: true,
    status: "Linked",
  },
  {
    id: "ipfs",
    name: "IPFS",
    description: "Decentralized file storage",
    connected: false,
    status: null,
  },
];

const notificationSettings = [
  {
    id: "job_updates",
    label: "Job Updates",
    description: "Get notified when jobs change status",
    onchain: true,
    push: true,
  },
  {
    id: "payment_alerts",
    label: "Payment Alerts",
    description: "Alerts for USDC payments and escrow releases",
    onchain: true,
    push: true,
  },
  {
    id: "agent_activity",
    label: "Agent Activity",
    description: "Updates on agent submissions and completions",
    onchain: false,
    push: true,
  },
  {
    id: "reputation_changes",
    label: "Reputation Changes",
    description: "Notifications when reputation scores change",
    onchain: false,
    push: false,
  },
  {
    id: "expiry_warnings",
    label: "Expiry Warnings",
    description: "Alerts before jobs or escrows expire",
    onchain: false,
    push: true,
  },
];

export function SettingsSection() {
  const [activeTab, setActiveTab] = useState("wallet");
  const [notifications, setNotifications] = useState(notificationSettings);
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = () => {
    setIsSaving(true);
    setTimeout(() => setIsSaving(false), 1500);
  };

  const toggleNotification = (id: string, type: "onchain" | "push") => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, [type]: !n[type] } : n))
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">Settings</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your wallet, preferences, and integrations
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="bg-secondary border border-border p-1">
          <TabsTrigger
            value="wallet"
            className="data-[state=active]:bg-card data-[state=active]:text-foreground"
          >
            <Wallet className="w-4 h-4 mr-2" />
            Wallet
          </TabsTrigger>
          <TabsTrigger
            value="notifications"
            className="data-[state=active]:bg-card data-[state=active]:text-foreground"
          >
            <Bell className="w-4 h-4 mr-2" />
            Notifications
          </TabsTrigger>
          <TabsTrigger
            value="integrations"
            className="data-[state=active]:bg-card data-[state=active]:text-foreground"
          >
            <Link2 className="w-4 h-4 mr-2" />
            Integrations
          </TabsTrigger>
          <TabsTrigger
            value="security"
            className="data-[state=active]:bg-card data-[state=active]:text-foreground"
          >
            <Shield className="w-4 h-4 mr-2" />
            Security
          </TabsTrigger>
        </TabsList>

        {/* Wallet Tab */}
        <TabsContent value="wallet" className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="text-base font-medium">Connected Wallet</CardTitle>
              <CardDescription>Your primary wallet for transactions on forge</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center gap-6 p-4 rounded-lg bg-secondary/50 border border-border">
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-accent/80 to-chart-1 flex items-center justify-center">
                  <Wallet className="w-6 h-6 text-accent-foreground" />
                </div>
                <div className="flex-1">
                  <p className="text-sm text-muted-foreground">Connected Address</p>
                  <div className="flex items-center gap-2">
                    <p className="text-lg font-mono font-medium text-foreground">0x7a2f...8f41</p>
                    <button className="p-1 hover:bg-secondary rounded transition-colors">
                      <Copy className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                    </button>
                  </div>
                </div>
                <Button variant="outline" size="sm">
                  Disconnect
                </Button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-lg bg-secondary/30 border border-border">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                    <Coins className="w-4 h-4" />
                    USDC Balance
                  </div>
                  <p className="text-2xl font-bold font-mono text-foreground">1,247 <span className="text-sm font-normal text-muted-foreground">USDC</span></p>
                </div>
                <div className="p-4 rounded-lg bg-secondary/30 border border-border">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                    <Bot className="w-4 h-4" />
                    Registered Agents
                  </div>
                  <p className="text-2xl font-bold text-foreground">3</p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="network">Network</Label>
                <Select defaultValue="testnet">
                  <SelectTrigger className="bg-secondary border-border w-full md:w-[300px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="testnet">Arc Testnet</SelectItem>
                    <SelectItem value="mainnet" disabled>Arc Mainnet (Coming Soon)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="text-base font-medium">Display Preferences</CardTitle>
              <CardDescription>Customize how data is displayed</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Palette className="w-5 h-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium text-foreground">Dark Mode</p>
                    <p className="text-sm text-muted-foreground">Use dark theme for the interface</p>
                  </div>
                </div>
                <Switch defaultChecked />
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Globe className="w-5 h-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium text-foreground">Amount Display</p>
                    <p className="text-sm text-muted-foreground">Show amounts in USDC or USD equivalent</p>
                  </div>
                </div>
                <Select defaultValue="usdc">
                  <SelectTrigger className="w-[120px] bg-secondary border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="usdc">USDC</SelectItem>
                    <SelectItem value="usd">USD ($)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Key className="w-5 h-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium text-foreground">Show Full Addresses</p>
                    <p className="text-sm text-muted-foreground">Display complete wallet addresses</p>
                  </div>
                </div>
                <Switch />
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button
              onClick={handleSave}
              className="bg-accent hover:bg-accent/90 text-accent-foreground"
              disabled={isSaving}
            >
              {isSaving ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4 mr-2" />
                  Save Changes
                </>
              )}
            </Button>
          </div>
        </TabsContent>

        {/* Notifications Tab */}
        <TabsContent value="notifications" className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="text-base font-medium">Notification Preferences</CardTitle>
              <CardDescription>Choose how and when you want to be notified</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                <div className="grid grid-cols-[1fr,80px,80px] gap-4 pb-3 border-b border-border text-sm text-muted-foreground">
                  <span>Notification Type</span>
                  <span className="text-center flex items-center justify-center gap-1.5">
                    <Link2 className="w-4 h-4" />
                    Onchain
                  </span>
                  <span className="text-center flex items-center justify-center gap-1.5">
                    <Bell className="w-4 h-4" />
                    Push
                  </span>
                </div>
                {notifications.map((notification, index) => (
                  <div
                    key={notification.id}
                    className="grid grid-cols-[1fr,80px,80px] gap-4 py-4 border-b border-border last:border-0 animate-in fade-in slide-in-from-left-2"
                    style={{ animationDelay: `${index * 50}ms` }}
                  >
                    <div>
                      <p className="font-medium text-foreground">{notification.label}</p>
                      <p className="text-sm text-muted-foreground">{notification.description}</p>
                    </div>
                    <div className="flex items-center justify-center">
                      <Switch
                        checked={notification.onchain}
                        onCheckedChange={() => toggleNotification(notification.id, "onchain")}
                      />
                    </div>
                    <div className="flex items-center justify-center">
                      <Switch
                        checked={notification.push}
                        onCheckedChange={() => toggleNotification(notification.id, "push")}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Integrations Tab */}
        <TabsContent value="integrations" className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="text-base font-medium">Connected Services</CardTitle>
              <CardDescription>Manage your blockchain and API integrations</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {integrations.map((integration, index) => (
                  <div
                    key={integration.id}
                    className={`p-4 rounded-lg border transition-all duration-300 animate-in fade-in slide-in-from-bottom-2 ${
                      integration.connected
                        ? "bg-secondary/50 border-border hover:border-accent/50"
                        : "bg-secondary/20 border-border hover:border-muted-foreground/30"
                    }`}
                    style={{ animationDelay: `${index * 75}ms` }}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                            integration.connected ? "bg-accent/20" : "bg-muted"
                          }`}
                        >
                          <Zap
                            className={`w-5 h-5 ${
                              integration.connected ? "text-accent" : "text-muted-foreground"
                            }`}
                          />
                        </div>
                        <div>
                          <p className="font-medium text-foreground">{integration.name}</p>
                          <p className="text-sm text-muted-foreground">{integration.description}</p>
                        </div>
                      </div>
                      <Badge
                        className={
                          integration.connected
                            ? "bg-accent/20 text-accent border-accent/30"
                            : "bg-muted text-muted-foreground border-border"
                        }
                      >
                        {integration.connected ? "Connected" : "Not connected"}
                      </Badge>
                    </div>
                    <div className="mt-4 flex items-center justify-between">
                      {integration.connected ? (
                        <>
                          <span className="text-xs font-mono text-muted-foreground">
                            {integration.balance ? `${integration.balance} USDC` : integration.network || integration.status}
                          </span>
                          <div className="flex items-center gap-2">
                            <Button variant="ghost" size="sm" className="h-8">
                              <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                              Refresh
                            </Button>
                            <Button variant="ghost" size="sm" className="h-8 text-destructive hover:text-destructive">
                              Disconnect
                            </Button>
                          </div>
                        </>
                      ) : (
                        <>
                          <span className="text-xs text-muted-foreground">Not configured</span>
                          <Button
                            size="sm"
                            className="h-8 bg-accent hover:bg-accent/90 text-accent-foreground"
                          >
                            Connect
                            <ExternalLink className="w-3.5 h-3.5 ml-1.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Security Tab */}
        <TabsContent value="security" className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="text-base font-medium">API Keys</CardTitle>
              <CardDescription>Manage API keys for programmatic access</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="p-4 rounded-lg bg-secondary/50 border border-border">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="font-medium text-foreground">Production API Key</p>
                    <p className="text-sm text-muted-foreground">Use this key for production applications</p>
                  </div>
                  <Badge className="bg-success/20 text-success border-success/30">Active</Badge>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="password"
                    value="(your-production-stripe-key)"
                    readOnly
                    className="bg-background border-border font-mono text-sm"
                  />
                  <Button variant="outline" size="sm">
                    <Copy className="w-4 h-4" />
                  </Button>
                  <Button variant="outline" size="sm">
                    Regenerate
                  </Button>
                </div>
              </div>
              <div className="p-4 rounded-lg bg-secondary/50 border border-border">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="font-medium text-foreground">Test API Key</p>
                    <p className="text-sm text-muted-foreground">Use this key for development and testing</p>
                  </div>
                  <Badge className="bg-muted text-muted-foreground border-border">Test Mode</Badge>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="password"
                    value="(your-test-stripe-key)"
                    readOnly
                    className="bg-background border-border font-mono text-sm"
                  />
                  <Button variant="outline" size="sm">
                    <Copy className="w-4 h-4" />
                  </Button>
                  <Button variant="outline" size="sm">
                    Regenerate
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="text-base font-medium">Transaction Signing</CardTitle>
              <CardDescription>Configure how transactions are signed</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between p-4 rounded-lg bg-secondary/50 border border-border">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-accent/20 flex items-center justify-center">
                    <Shield className="w-5 h-5 text-accent" />
                  </div>
                  <div>
                    <p className="font-medium text-foreground">Require Confirmation</p>
                    <p className="text-sm text-muted-foreground">
                      Confirm all transactions above 100 USDC
                    </p>
                  </div>
                </div>
                <Switch defaultChecked />
              </div>
            </CardContent>
          </Card>

          <Card className="border-border bg-card border-destructive/30">
            <CardHeader>
              <CardTitle className="text-base font-medium text-destructive flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                Danger Zone
              </CardTitle>
              <CardDescription>Irreversible actions</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-4 rounded-lg bg-destructive/5 border border-destructive/20">
                <div>
                  <p className="font-medium text-foreground">Deactivate Account</p>
                  <p className="text-sm text-muted-foreground">
                    This will cancel all active jobs and release escrowed funds
                  </p>
                </div>
                <Button variant="destructive" size="sm">
                  Deactivate
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
