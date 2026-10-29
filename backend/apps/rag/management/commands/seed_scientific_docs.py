"""Management command to seed scientific documentation for RAG."""

from django.core.management.base import BaseCommand

from apps.rag.models import IndexedDocument, DocumentSource, DocumentStatus
from apps.rag.tasks import index_scientific_document_task


# Foundational scientific documentation about DLA, CCA, and fractal analysis
SEED_DOCUMENTS = [
    {
        "title": "Diffusion-Limited Aggregation (DLA) Overview",
        "abstract": """
Diffusion-Limited Aggregation (DLA) is a process where particles undergo random walks
and stick irreversibly upon first contact with a growing cluster. The resulting
aggregates have a characteristic fractal dimension.

Key characteristics:
- Fractal dimension Df approximately 1.71 in 2D and 2.5 in 3D
- Prefactor kf typically around 1.3
- Open, branching structure with dendritic morphology
- Self-similar at different scales
- Introduced by Witten and Sander in 1981

The DLA model is widely used in:
- Electrodeposition modeling
- Crystal growth simulation
- Aerosol particle aggregation
- Biological pattern formation

The fractal dimension of DLA clusters depends on the dimensionality of space:
- 2D: Df ≈ 1.71
- 3D: Df ≈ 2.50

The scaling relationship is: N = kf * (Rg/a)^Df
where N is the number of particles, Rg is the radius of gyration, and a is the
primary particle radius.
""",
        "authors": ["System Documentation"],
        "year": 2024,
    },
    {
        "title": "Cluster-Cluster Aggregation (CCA/DLCA) Overview",
        "abstract": """
Cluster-Cluster Aggregation (CCA), also known as Diffusion-Limited Cluster Aggregation
(DLCA), is a process where clusters of particles diffuse and aggregate with other
clusters upon contact.

Key characteristics:
- Fractal dimension Df approximately 1.78 in 2D and 1.8 in 3D
- More compact structure than DLA
- Clusters grow by merging with other clusters, not just single particles
- Results in more uniform, less dendritic structures

Comparison with DLA:
- CCA produces lower fractal dimensions than DLA
- CCA clusters are more compact and less branched
- CCA better represents real aerosol aggregation processes

The CCA model is particularly relevant for:
- Soot particle formation
- Colloidal aggregation
- Aerosol science
- Nanoparticle synthesis

Typical fractal dimensions for CCA:
- 3D DLCA: Df ≈ 1.78-1.82
- 3D RLCA (Reaction-Limited): Df ≈ 2.0-2.1
""",
        "authors": ["System Documentation"],
        "year": 2024,
    },
    {
        "title": "Ballistic Aggregation Overview",
        "abstract": """
Ballistic Aggregation is a process where particles travel in straight lines and
stick upon contact with the cluster. This contrasts with diffusion-based processes
where particles follow random walks.

Key types:
1. Ballistic Particle-Cluster Aggregation (BPCA):
   - Single particles attach to a growing cluster
   - Fractal dimension Df ≈ 3.0 (nearly space-filling)
   - Very compact structures

2. Ballistic Cluster-Cluster Aggregation (BCCA):
   - Clusters collide ballistically
   - Fractal dimension Df ≈ 1.95
   - More compact than DLCA

Characteristics:
- Produces more compact aggregates than diffusion-limited processes
- Relevant for high-velocity particle collisions
- Important in astrophysical dust aggregation
- Used in modeling dense aerosol systems

The ballistic limit represents one extreme of aggregation dynamics, with the
diffusion limit at the other extreme. Real systems often fall between these limits.
""",
        "authors": ["System Documentation"],
        "year": 2024,
    },
    {
        "title": "Fractal Dimension Measurement Methods",
        "abstract": """
Fractal dimension (Df) can be measured using several methods:

1. Box-Counting Method:
   - Covers the aggregate with boxes of size ε
   - Counts boxes N(ε) containing part of the aggregate
   - Df = -d(log N) / d(log ε)
   - Most common method for discrete particle aggregates

2. Sandbox Method:
   - Counts particles within radius r from center of mass
   - N(r) ~ r^Df
   - Good for 3D aggregates

3. Correlation Dimension:
   - Uses pair correlation function
   - Df from slope of log-log plot

4. Radius of Gyration Method:
   - Uses scaling: N = kf * (Rg/a)^Df
   - Requires known prefactor kf
   - Common in aerosol science

Typical values:
- DLA 3D: Df ≈ 2.5
- DLCA 3D: Df ≈ 1.78
- BCCA: Df ≈ 1.95
- BPCA: Df ≈ 3.0

The prefactor kf depends on the aggregation mechanism:
- DLCA: kf ≈ 1.3
- BCCA: kf ≈ 1.4
- Higher kf indicates more compact packing at small scales
""",
        "authors": ["System Documentation"],
        "year": 2024,
    },
    {
        "title": "Sticking Probability Effects on Aggregation",
        "abstract": """
Sticking probability (Ps) determines the likelihood that particles stick upon contact.
This parameter allows transition between different aggregation regimes.

Effects of sticking probability:
- Ps = 1 (DLCA): Irreversible sticking, lower Df
- Ps << 1 (RLCA): Reaction-limited, particles may bounce before sticking
- Lower Ps leads to more compact aggregates and higher Df

Reaction-Limited Cluster Aggregation (RLCA):
- Sticking probability significantly less than 1
- Particles can penetrate deeper into clusters before sticking
- Results in more compact structures
- Df ≈ 2.0-2.1 in 3D

The transition from DLCA to RLCA:
- As Ps decreases, Df increases
- The prefactor kf also increases
- Aggregate morphology becomes more compact

Applications:
- Ps < 1 simulates:
  - Electrostatic repulsion between particles
  - Energy barriers to aggregation
  - Partially reversible aggregation
  - Polymer-mediated interactions
""",
        "authors": ["System Documentation"],
        "year": 2024,
    },
    {
        "title": "Sintering in Particle Aggregates",
        "abstract": """
Sintering is the process where contact between particles grows over time,
leading to particle fusion and restructuring of aggregates.

Effects on aggregate structure:
- Increases overlap between particles
- Reduces porosity
- Can increase fractal dimension as structure compacts
- Changes optical and mechanical properties

Sintering coefficient:
- Represents the degree of particle overlap
- Value of 0: Point contact (no sintering)
- Value > 0: Particles overlap/fuse
- Typical range: 0 to 0.5

Impact on measurements:
- Affects radius of gyration calculation
- Changes effective fractal dimension
- Modifies prefactor kf
- Important for accurate modeling of real aerosols

Sintering is particularly important in:
- Soot particle modeling
- Flame-generated nanoparticles
- High-temperature aerosols
- Metal particle synthesis
""",
        "authors": ["System Documentation"],
        "year": 2024,
    },
]


class Command(BaseCommand):
    """Seed the RAG database with scientific documentation."""

    help = "Seed the RAG database with foundational scientific documentation"

    def add_arguments(self, parser):
        parser.add_argument(
            "--force",
            action="store_true",
            help="Overwrite existing documents with the same title",
        )
        parser.add_argument(
            "--sync",
            action="store_true",
            help="Index synchronously instead of queuing tasks",
        )

    def handle(self, *args, **options):
        created_count = 0
        updated_count = 0
        skipped_count = 0

        for doc_data in SEED_DOCUMENTS:
            existing = IndexedDocument.objects.filter(
                title=doc_data["title"],
                source_type=DocumentSource.SCIENTIFIC_DOC,
                is_global=True,
            ).first()

            if existing:
                if options["force"]:
                    # Update existing document
                    existing.abstract = doc_data["abstract"]
                    existing.authors = doc_data["authors"]
                    existing.year = doc_data["year"]
                    existing.status = DocumentStatus.PENDING
                    existing.save()
                    updated_count += 1

                    if options["sync"]:
                        result = index_scientific_document_task(str(existing.id))
                        self.stdout.write(
                            f"  Updated and indexed: {doc_data['title'][:50]}... "
                            f"({result.get('status', 'unknown')})"
                        )
                    else:
                        index_scientific_document_task.delay(str(existing.id))
                        self.stdout.write(
                            f"  Updated and queued: {doc_data['title'][:50]}..."
                        )
                else:
                    skipped_count += 1
                    self.stdout.write(
                        f"  Skipped (exists): {doc_data['title'][:50]}..."
                    )
            else:
                # Create new document
                doc = IndexedDocument.objects.create(
                    title=doc_data["title"],
                    abstract=doc_data["abstract"],
                    authors=doc_data["authors"],
                    year=doc_data["year"],
                    source_type=DocumentSource.SCIENTIFIC_DOC,
                    is_global=True,
                    status=DocumentStatus.PENDING,
                    content_hash="",
                )
                created_count += 1

                if options["sync"]:
                    result = index_scientific_document_task(str(doc.id))
                    self.stdout.write(
                        f"  Created and indexed: {doc_data['title'][:50]}... "
                        f"({result.get('status', 'unknown')})"
                    )
                else:
                    index_scientific_document_task.delay(str(doc.id))
                    self.stdout.write(
                        f"  Created and queued: {doc_data['title'][:50]}..."
                    )

        self.stdout.write(
            self.style.SUCCESS(
                f"Seeding complete: {created_count} created, "
                f"{updated_count} updated, {skipped_count} skipped"
            )
        )
