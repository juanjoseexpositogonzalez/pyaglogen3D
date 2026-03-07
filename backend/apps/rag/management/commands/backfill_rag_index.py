"""Management command to backfill RAG index with existing data."""

from django.core.management.base import BaseCommand, CommandParser
from django.contrib.auth import get_user_model

from apps.rag.tasks import (
    index_simulation_task,
    index_analysis_task,
    reindex_all_user_data,
)


class Command(BaseCommand):
    """Backfill RAG index with existing simulations and analyses."""

    help = "Backfill RAG index with existing simulations and analyses"

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument(
            "--user",
            type=str,
            help="Index only for specific user email",
        )
        parser.add_argument(
            "--sync",
            action="store_true",
            help="Run synchronously instead of queuing tasks",
        )
        parser.add_argument(
            "--simulations-only",
            action="store_true",
            help="Only index simulations",
        )
        parser.add_argument(
            "--analyses-only",
            action="store_true",
            help="Only index analyses",
        )

    def handle(self, *args, **options) -> None:
        User = get_user_model()

        if options["user"]:
            try:
                users = [User.objects.get(email=options["user"])]
            except User.DoesNotExist:
                self.stderr.write(
                    self.style.ERROR(f"User not found: {options['user']}")
                )
                return
        else:
            users = User.objects.all()

        total_queued = 0

        for user in users:
            self.stdout.write(f"Processing user: {user.email}")

            if options["sync"]:
                # Run synchronously
                queued = self._index_sync(
                    user,
                    simulations_only=options["simulations_only"],
                    analyses_only=options["analyses_only"],
                )
            else:
                # Queue for async processing
                if not options["simulations_only"] and not options["analyses_only"]:
                    # Use the combined task
                    reindex_all_user_data.delay(str(user.id))
                    queued = "all (async)"
                else:
                    queued = self._queue_tasks(
                        user,
                        simulations_only=options["simulations_only"],
                        analyses_only=options["analyses_only"],
                    )

            self.stdout.write(f"  Queued: {queued}")
            if isinstance(queued, int):
                total_queued += queued

        self.stdout.write(
            self.style.SUCCESS(f"Backfill initiated. Total queued: {total_queued}")
        )

    def _index_sync(self, user, simulations_only: bool, analyses_only: bool) -> int:
        """Index synchronously for a user."""
        from apps.simulations.models import Simulation, SimulationStatus
        from apps.fractal_analysis.models import FraktalAnalysis, AnalysisStatus

        count = 0

        if not analyses_only:
            sims = Simulation.objects.filter(
                project__owner=user,
                status=SimulationStatus.COMPLETED,
            )
            for sim in sims:
                result = index_simulation_task(str(sim.id))
                status = result.get("status", "unknown")
                self.stdout.write(f"    Simulation {sim.id}: {status}")
                if status == "success":
                    count += 1

        if not simulations_only:
            analyses = FraktalAnalysis.objects.filter(
                project__owner=user,
                status=AnalysisStatus.COMPLETED,
            )
            for analysis in analyses:
                result = index_analysis_task(str(analysis.id))
                status = result.get("status", "unknown")
                self.stdout.write(f"    Analysis {analysis.id}: {status}")
                if status == "success":
                    count += 1

        return count

    def _queue_tasks(
        self, user, simulations_only: bool, analyses_only: bool
    ) -> int:
        """Queue indexing tasks for a user."""
        from apps.simulations.models import Simulation, SimulationStatus
        from apps.fractal_analysis.models import FraktalAnalysis, AnalysisStatus

        count = 0

        if not analyses_only:
            sims = Simulation.objects.filter(
                project__owner=user,
                status=SimulationStatus.COMPLETED,
            ).values_list("id", flat=True)
            for sim_id in sims:
                index_simulation_task.delay(str(sim_id))
                count += 1

        if not simulations_only:
            analyses = FraktalAnalysis.objects.filter(
                project__owner=user,
                status=AnalysisStatus.COMPLETED,
            ).values_list("id", flat=True)
            for analysis_id in analyses:
                index_analysis_task.delay(str(analysis_id))
                count += 1

        return count
