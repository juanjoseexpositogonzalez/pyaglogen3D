import Link from 'next/link'

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <div className="text-center">
        <h1 className="text-5xl font-bold mb-4">pyAgloGen3D</h1>
        <p className="text-xl text-muted-foreground mb-8">
          3D Agglomerate Simulation and Fractal Analysis Platform
        </p>

        <div className="flex gap-4 justify-center">
          <Link
            href="/dashboard"
            className="bg-primary text-primary-foreground px-6 py-3 rounded-lg font-medium hover:opacity-90 transition"
          >
            Go to Dashboard
          </Link>
          <a
            href="http://localhost:8000/api/v1/"
            target="_blank"
            rel="noopener noreferrer"
            className="bg-secondary text-secondary-foreground px-6 py-3 rounded-lg font-medium hover:opacity-90 transition"
          >
            API Docs
          </a>
        </div>

        <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl">
          <FeatureCard
            title="3D Simulation"
            description="DLA, CCA, Ballistic aggregation with real-time visualization"
          />
          <FeatureCard
            title="Fractal Analysis"
            description="Box-counting, Sandbox, Multifractal methods for 2D images"
          />
          <FeatureCard
            title="Full Reproducibility"
            description="All parameters and results persisted for scientific research"
          />
        </div>
      </div>
    </main>
  )
}

function FeatureCard({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="bg-secondary/50 rounded-lg p-6 text-left">
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  )
}
