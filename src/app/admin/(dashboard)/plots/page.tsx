import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getProjectOptions } from "@/lib/cache";
import {
  PLOT_STATUS_ORDER,
  PLOT_STATUS_STYLES,
  type PlotStatus,
} from "@/lib/layout";
import { formatPrice, formatSqft } from "@/lib/format";
import PageHeader from "@/components/admin/PageHeader";
import SearchBar from "@/components/admin/SearchBar";
import AdminPagination from "@/components/admin/AdminPagination";
import EmptyState from "@/components/admin/EmptyState";
import { requirePageAccess } from "@/lib/guard";

export const dynamic = "force-dynamic";

const PER_PAGE = 25;

interface Props {
  searchParams: Promise<{
    q?: string;
    status?: string;
    projectId?: string;
    page?: string;
  }>;
}

export default async function AdminPlotsPage({ searchParams }: Props) {
  await requirePageAccess("plots:view");
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const where: Prisma.PlotWhereInput = {};
  if (q) {
    where.OR = [
      { plotNumber: { contains: q, mode: "insensitive" } },
      { facing: { contains: q, mode: "insensitive" } },
      { project: { name: { contains: q, mode: "insensitive" } } },
    ];
  }
  if (PLOT_STATUS_ORDER.includes(params.status as PlotStatus)) {
    where.status = params.status as PlotStatus;
  }
  if (params.projectId) where.projectId = params.projectId;

  const [plots, total, projects] = await Promise.all([
    prisma.plot.findMany({
      where,
      include: { project: { select: { id: true, name: true } } },
      orderBy: [{ project: { name: "asc" } }, { plotNumber: "asc" }],
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
    }),
    prisma.plot.count({ where }),
    // Cached across requests and invalidated by any venture write — the venture
    // <select> no longer costs a full table scan on every plots page view.
    getProjectOptions(),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  const isFiltered = Boolean(q || params.status || params.projectId);

  return (
    <>
      <PageHeader
        eyebrow="Content"
        title="Plots"
        description="Individual plots across every venture."
        action={{ href: "/admin/plots/new", label: "New plot" }}
      />

      <SearchBar
        placeholder="Search plots"
        total={total}
        filters={[
          {
            name: "projectId",
            label: "Venture",
            options: [
              { value: "", label: "All" },
              ...projects.map((p) => ({ value: p.id, label: p.name })),
            ],
          },
          {
            name: "status",
            label: "Status",
            options: [
              { value: "", label: "Any" },
              ...PLOT_STATUS_ORDER.map((status) => ({
                value: status,
                label: PLOT_STATUS_STYLES[status].label,
              })),
            ],
          },
        ]}
      />

      {plots.length === 0 ? (
        <div className="mt-10">
          <EmptyState
            title={isFiltered ? "Nothing matches that." : "No plots yet."}
            body={
              isFiltered
                ? "Try a different search, or clear the filters."
                : "Add plots to a venture and they will appear on the public plots page."
            }
            action={
              isFiltered
                ? undefined
                : { href: "/admin/plots/new", label: "Create a plot" }
            }
          />
        </div>
      ) : (
        <>
          <div className="mt-10 overflow-x-auto">
            <table className="table-admin min-w-[760px]">
              <thead>
                <tr>
                  <th>Plot</th>
                  <th>Venture</th>
                  <th>Size</th>
                  <th>Price</th>
                  <th>Facing</th>
                  <th>Status</th>
                  <th className="sr-only">Actions</th>
                </tr>
              </thead>
              <tbody>
                {plots.map((plot) => (
                  <tr key={plot.id}>
                    <td>
                      <Link
                        href={`/admin/plots/${plot.id}/edit`}
                        className="link-underline font-serif text-base"
                      >
                        {plot.plotNumber}
                      </Link>
                    </td>
                    <td className="text-muted">{plot.project.name}</td>
                    <td className="whitespace-nowrap">
                      {formatSqft(plot.sizeSqft)}
                    </td>
                    <td className="whitespace-nowrap">
                      {plot.priceOnRequest ? (
                        <span className="text-muted">On enquiry</span>
                      ) : (
                        formatPrice(plot.price)
                      )}
                    </td>
                    <td className="text-muted">{plot.facing ?? "—"}</td>
                    <td>
                      <span className="chip border-charcoal/20">
                        <span
                          aria-hidden
                          className="inline-block h-2 w-2 shrink-0"
                          style={{
                            backgroundColor:
                              PLOT_STATUS_STYLES[plot.status as PlotStatus]
                                .swatch,
                          }}
                        />
                        {PLOT_STATUS_STYLES[plot.status as PlotStatus].label}
                      </span>
                    </td>
                    <td className="text-right">
                      <Link
                        href={`/admin/plots/${plot.id}/edit`}
                        className="link-underline whitespace-nowrap text-[10px] uppercase tracking-[0.22em]"
                      >
                        Edit
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <AdminPagination page={page} totalPages={totalPages} />
        </>
      )}
    </>
  );
}
