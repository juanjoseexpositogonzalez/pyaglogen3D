/**
 * The presentational primitives. Less likely to break, but they carry the
 * scientific-UI guarantees the contract rests on: uncertainty, provenance and
 * the refusal to show a measured value without saying how it was obtained.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { DetailList } from '../DetailList'
import { EmptyState } from '../EmptyState'
import { FilterBar, FilterField } from '../FilterBar'
import { MetricCard } from '../MetricCard'
import { PageHeader } from '../PageHeader'
import { DisclosurePanel } from '../DisclosurePanel'
import { Panel } from '../Panel'
import { VisualPanel } from '../VisualPanel'

describe('DetailList', () => {
  it('renders a null value as an em dash through Num', () => {
    render(<DetailList items={[{ label: 'Radius of gyration', value: null, unit: 'nm' }]} />)
    expect(screen.getByText('—')).toBeTruthy()
  })

  it('treats undefined like null instead of rendering an empty cell', () => {
    // ReactNode includes undefined, and optional backend fields arrive that
    // way rather than as null.
    render(<DetailList items={[{ label: 'Prefactor', value: undefined }]} />)
    expect(screen.getByText('—')).toBeTruthy()
  })

  it('passes a node value through untouched', () => {
    render(<DetailList items={[{ label: 'Algorithm', value: <span>Tunable CC</span> }]} />)
    expect(screen.getByText('Tunable CC')).toBeTruthy()
  })

  it('shows where an inherited value came from', () => {
    render(
      <DetailList
        items={[{ label: 'dpo', value: 14, unit: 'nm', provenance: 'from simulation' }]}
      />,
    )
    expect(screen.getByText('(from simulation)')).toBeTruthy()
  })

  it('keeps the unit out of the numeric value', () => {
    const { container } = render(<DetailList items={[{ label: 'Rg', value: 68.4, unit: 'nm' }]} />)
    expect(container.querySelector('.num')?.textContent).toBe('68.40')
  })
})

describe('MetricCard', () => {
  it('shows uncertainty and the estimator for a measured quantity', () => {
    render(
      <MetricCard
        kind="measured"
        label="Fractal dimension"
        value={2.533}
        sigma={0.041}
        detail="R² 0.994 · box counting"
      />,
    )
    expect(screen.getByText('2.533')).toBeTruthy()
    expect(screen.getByText('±0.041')).toBeTruthy()
    expect(screen.getByText('R² 0.994 · box counting')).toBeTruthy()
  })

  it('asks no uncertainty of a quantity that is exact by construction', () => {
    render(<MetricCard kind="exact" label="Particles" value={512} digits={0} />)
    expect(screen.getByText('512')).toBeTruthy()
  })

  it('states a delta in words, not only in colour', () => {
    render(
      <MetricCard
        kind="measured"
        label="Df"
        value={2.533}
        sigma={0.04}
        detail="box counting"
        delta={{ text: '-0.167 vs target', quality: 'poor' }}
      />,
    )
    expect(screen.getByText('-0.167 vs target')).toBeTruthy()
  })

  it('clamps the announced progress instead of exceeding its own maximum', () => {
    render(
      <MetricCard kind="exact" label="Queue" value={9} digits={0} progress={1.4} />,
    )
    const bar = screen.getByRole('progressbar')
    expect(bar.getAttribute('aria-valuenow')).toBe('100')
    expect(bar.getAttribute('aria-valuemax')).toBe('100')
  })

  it('renders no progress bar for a non-finite ratio', () => {
    // A computed/total ratio with a zero denominator is plausible and would
    // otherwise announce aria-valuenow="NaN".
    render(<MetricCard kind="exact" label="Queue" value={0} digits={0} progress={Number.NaN} />)
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('names the progress bar', () => {
    render(<MetricCard kind="exact" label="Engine queue" value={3} digits={0} progress={0.5} />)
    expect(screen.getByRole('progressbar').getAttribute('aria-label')).toBe('Engine queue progress')
  })
})

// The page outline is a contract between primitives, not a property of any
// one of them: PageHeader opens at 1, panels sit at 2, and a disclosure
// nested inside a panel sits at 3. Pinned together because the levels only
// mean something relative to each other, and nothing else here would notice
// one of them drifting.
describe('the heading levels the kit emits', () => {
  // Rendered through factories rather than inline elements: passing a React
  // element to `it.each` makes the name formatter walk the tree and blow the
  // stack, which reports as "no tests" instead of as a failure.
  const cases: Array<[string, number, string, () => void]> = [
    ['PageHeader', 1, 'Soot aggregate 12', () => render(<PageHeader title="Soot aggregate 12" />)],
    ['Panel', 2, 'Coordination number', () => render(<Panel title="Coordination number">body</Panel>)],
    ['VisualPanel', 2, 'Projection', () => render(<VisualPanel title="Projection">body</VisualPanel>)],
    ['DisclosurePanel', 3, 'Raw values', () => render(<DisclosurePanel title="Raw values">body</DisclosurePanel>)],
  ]

  it.each(cases)('%s opens at level %i', (_name, level, title, mount) => {
    mount()
    expect(screen.getByRole('heading', { level, name: title })).toBeTruthy()
  })
})

describe('Panel', () => {
  it('renders its title as a heading so the page outlines correctly', () => {
    render(
      <Panel title="Coordination number" hint="Contacts per primary particle">
        <p>body</p>
      </Panel>,
    )
    expect(screen.getByRole('heading', { level: 2, name: 'Coordination number' })).toBeTruthy()
    expect(screen.getByText('Contacts per primary particle')).toBeTruthy()
  })

  it('omits the header entirely when there is nothing to put in it', () => {
    render(
      <Panel>
        <p>body</p>
      </Panel>,
    )
    expect(screen.queryByRole('heading')).toBeNull()
  })
})

describe('PageHeader', () => {
  it('puts the title in a level-one heading', () => {
    render(<PageHeader eyebrow="SIMULATION" title="Soot aggregate 12" />)
    expect(screen.getByRole('heading', { level: 1, name: 'Soot aggregate 12' })).toBeTruthy()
    expect(screen.getByText('SIMULATION')).toBeTruthy()
  })
})

describe('EmptyState', () => {
  it('explains what the surface is for, not merely that it is empty', () => {
    render(
      <EmptyState
        title="No simulations yet"
        description="A simulation generates a 3D agglomerate from an algorithm and a seed."
      />,
    )
    expect(screen.getByText(/generates a 3D agglomerate/)).toBeTruthy()
  })
})

describe('FilterBar', () => {
  it('shows a result count of zero, which is when it matters most', () => {
    // A React element is truthy, so passing one here would have passed
    // against the broken `{hint && ...}` too. A bare 0 is the case the guard
    // exists for: the filter matched nothing.
    // Asserting getByText('0') is not enough: with the broken `{hint && ...}`
    // guard, `0 && <span>` evaluates to 0 and React renders a bare text node,
    // which getByText finds just the same. The hint has to be IN its wrapper.
    const { container } = render(
      <FilterBar hint={0}>
        <FilterField label="Quality">
          <select />
        </FilterField>
      </FilterBar>,
    )
    const hint = container.querySelector('.hint')
    expect(hint, 'the hint wrapper is missing, so the guard dropped it').not.toBeNull()
    expect(hint?.textContent).toBe('0')
  })

  it('still omits the hint when there is none', () => {
    const { container } = render(
      <FilterBar>
        <FilterField label="Quality">
          <select />
        </FilterField>
      </FilterBar>,
    )
    expect(container.querySelectorAll('.hint')).toHaveLength(0)
  })

  it('labels each control', () => {
    render(
      <FilterBar>
        <FilterField label="Quality">
          <select />
        </FilterField>
      </FilterBar>,
    )
    expect(screen.getByText('Quality')).toBeTruthy()
  })
})
