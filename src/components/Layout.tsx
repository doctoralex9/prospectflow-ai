import { useState } from "react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { useAuth } from "@/hooks/useAuth"
import { Button } from "@/components/ui/button"
import { LayoutDashboard, Users, Settings, LogOut, BookSearch, Menu, X } from "lucide-react"
import { cn } from "@/lib/utils"

const navItems = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard },
  { path: "/leads", label: "Leads", icon: Users },
  { path: "/settings", label: "Settings", icon: Settings },
]

export default function Layout({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation()
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const handleSignOut = async () => {
    await signOut()
    navigate("/auth")
  }

  // Dashboard is a full-screen scrollable experience — no sidebar
  if (pathname === "/") {
    return <div className="min-h-screen bg-background">{children}</div>
  }

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Mobile backdrop — tapping it closes the sidebar */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed lg:relative z-30 lg:z-auto h-full w-64 border-r bg-card flex flex-col shrink-0",
          "transition-transform duration-300 ease-in-out will-change-transform",
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        {/* Logo row */}
        <div className="p-5 border-b flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="bg-primary/10 rounded-lg p-1.5 border border-primary/20 shrink-0">
              <BookSearch className="h-4 w-4 text-primary" />
            </div>
            <span className="font-bold text-sm tracking-wide">PROSPECTFLOW AI</span>
          </div>
          {/* Close button — mobile only */}
          <button
            className="lg:hidden text-muted-foreground hover:text-foreground transition-colors rounded-md p-1 hover:bg-accent"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-0.5">
          {navItems.map(({ path, label, icon: Icon }, i) => (
            <Link
              key={path}
              to={path}
              onClick={() => setSidebarOpen(false)}
              className="sidebar-nav-item block"
              style={{ animationDelay: `${i * 65}ms` }}
            >
              <div
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium",
                  "transition-all duration-200",
                  pathname === path
                    ? "bg-primary/12 text-primary border-l-2 border-primary pl-[10px]"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent hover:translate-x-0.5"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {label}
              </div>
            </Link>
          ))}
        </nav>

        {/* User / sign-out */}
        <div className="p-3 border-t">
          <div className="text-xs text-muted-foreground mb-1.5 truncate px-3">{user?.email}</div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-muted-foreground hover:text-foreground transition-all duration-200 hover:translate-x-0.5"
            onClick={handleSignOut}
          >
            <LogOut className="h-4 w-4 mr-2" />
            Sign Out
          </Button>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile top bar — only visible below lg breakpoint */}
        <header className="flex items-center gap-3 px-4 py-3 border-b bg-background/90 backdrop-blur-md lg:hidden shrink-0">
          <button
            className="text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded-md hover:bg-accent"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="bg-primary/10 rounded p-1 border border-primary/20">
              <BookSearch className="h-3.5 w-3.5 text-primary" />
            </div>
            <span className="font-bold text-sm tracking-wide">PROSPECTFLOW AI</span>
          </div>
        </header>

        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
