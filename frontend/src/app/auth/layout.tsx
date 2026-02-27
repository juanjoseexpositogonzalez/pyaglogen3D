/**
 * Layout for authentication pages.
 *
 * Centered card layout for login, register, etc.
 */

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white">PyAglogen3D</h1>
          <p className="text-gray-400 mt-2">3D Agglomerate Simulation Platform</p>
        </div>
        {children}
      </div>
    </div>
  )
}
