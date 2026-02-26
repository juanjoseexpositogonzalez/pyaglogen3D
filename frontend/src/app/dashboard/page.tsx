'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useProjects } from '@/hooks/useProjects'
import { useAuth } from '@/contexts/AuthContext'
import { Header } from '@/components/layout/Header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { LoadingScreen } from '@/components/common/LoadingSpinner'
import { FolderOpen, Plus, Atom, ImageIcon, TrendingUp } from 'lucide-react'

export default function DashboardPage() {
  const router = useRouter()
  const { isLoading: authLoading, isAuthenticated } = useAuth()
  const { data, isLoading, error } = useProjects()

  // Redirect to login if not authenticated (after auth check completes)
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/auth/login')
    }
  }, [authLoading, isAuthenticated, router])

  // Show loading while checking auth
  if (authLoading) {
    return <LoadingScreen message="Checking authentication..." />
  }

  // Don't render dashboard content if not authenticated
  if (!isAuthenticated) {
    return <LoadingScreen message="Redirecting to login..." />
  }

  const projects = data?.results ?? []
  const totalSimulations = projects.reduce((acc, p) => acc + p.simulation_count, 0)
  const totalAnalyses = projects.reduce((acc, p) => acc + p.analysis_count, 0)

  return (
    <div className="min-h-screen">
      <Header />

      <main className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">Dashboard</h1>
            <p className="text-muted-foreground mt-1">
              Overview of your simulation projects
            </p>
          </div>
          <Link href="/projects/new">
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              New Project
            </Button>
          </Link>
        </div>

        {isLoading ? (
          <LoadingScreen message="Loading projects..." />
        ) : error ? (
          <Card className="border-destructive">
            <CardContent className="p-6">
              <p className="text-destructive">
                Failed to load projects. Make sure the backend is running.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Total Projects
                  </CardTitle>
                  <FolderOpen className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{projects.length}</div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Total Simulations
                  </CardTitle>
                  <Atom className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{totalSimulations}</div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Total Analyses
                  </CardTitle>
                  <ImageIcon className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{totalAnalyses}</div>
                </CardContent>
              </Card>
            </div>

            {/* Recent Projects */}
            <h2 className="text-xl font-semibold mb-4">Recent Projects</h2>
            {projects.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center">
                  <FolderOpen className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-medium mb-2">No projects yet</h3>
                  <p className="text-muted-foreground mb-4">
                    Create your first project to start running simulations
                  </p>
                  <Link href="/projects/new">
                    <Button>
                      <Plus className="h-4 w-4 mr-2" />
                      Create Project
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {projects.slice(0, 6).map((project) => (
                  <Link key={project.id} href={`/projects/${project.id}`}>
                    <Card className="hover:border-primary/50 transition-colors cursor-pointer h-full">
                      <CardHeader>
                        <CardTitle className="text-lg">{project.name}</CardTitle>
                        {project.description && (
                          <p className="text-sm text-muted-foreground line-clamp-2">
                            {project.description}
                          </p>
                        )}
                      </CardHeader>
                      <CardContent>
                        <div className="flex gap-4 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Atom className="h-4 w-4" />
                            {project.simulation_count} simulations
                          </span>
                          <span className="flex items-center gap-1">
                            <ImageIcon className="h-4 w-4" />
                            {project.analysis_count} analyses
                          </span>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
