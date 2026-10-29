import { vi } from 'vitest'

type EventHandler = (...args: unknown[]) => void

/**
 * Factory that creates a fresh mock Network instance.
 * Stores registered event handlers so tests can invoke them manually.
 */
export function createMockNetworkInstance() {
  const handlers: Record<string, EventHandler[]> = {}

  const instance = {
    on: vi.fn((event: string, handler: EventHandler) => {
      if (!handlers[event]) handlers[event] = []
      handlers[event].push(handler)
    }),
    once: vi.fn((event: string, handler: EventHandler) => {
      // Fire immediately on registration so tests synchronously verify behavior
      if (event === 'stabilizationIterationsDone') {
        handler()
      }
    }),
    destroy: vi.fn(),
    focus: vi.fn(),
    setOptions: vi.fn(),
    getNodes: vi.fn(() => []),
    getEdges: vi.fn(() => []),
  }

  return {
    instance,
    handlers,
    /** Invoke all registered handlers for a given event */
    fireEvent(event: string, ...args: unknown[]) {
      const fns = handlers[event] || []
      fns.forEach((fn) => fn(...args))
    },
  }
}

export type MockNetworkInstance = ReturnType<typeof createMockNetworkInstance>

let currentMock: MockNetworkInstance | null = null

export function getCurrentMock(): MockNetworkInstance | null {
  return currentMock
}

/** The mock Network constructor class */
export const MockNetwork = vi.fn((...args: unknown[]) => {
  currentMock = createMockNetworkInstance()
  // Track constructor args on the mock function
  MockNetwork.mock.results.push({ type: 'return', value: currentMock.instance })
  return currentMock.instance
})

export function resetMock() {
  currentMock = null
  MockNetwork.mockClear()
}

export function setupVisNetworkMock() {
  vi.mock('vis-network/standalone', () => ({
    Network: MockNetwork,
  }))
}
