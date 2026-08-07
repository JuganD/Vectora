using Microsoft.EntityFrameworkCore;
using Vectora.Api.Models;

namespace Vectora.Api.Data;

public class VectoraDbContext : DbContext
{
    public VectoraDbContext(DbContextOptions<VectoraDbContext> options) : base(options)
    {
    }

    public DbSet<ServiceBusConnection> Connections { get; set; }
    public DbSet<Setting> Settings { get; set; }
    public DbSet<MessageTemplate> MessageTemplates { get; set; }
    public DbSet<SearchHistoryEntry> SearchHistoryEntries { get; set; }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<ServiceBusConnection>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Name).IsRequired().HasMaxLength(200);
            entity.Property(e => e.ConnectionString).IsRequired();
            entity.HasIndex(e => e.Name).IsUnique();
        });

        modelBuilder.Entity<Setting>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Key).IsRequired().HasMaxLength(100);
            entity.Property(e => e.Value).IsRequired();
            entity.HasIndex(e => e.Key).IsUnique();
        });

        modelBuilder.Entity<MessageTemplate>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Name).IsRequired().HasMaxLength(200);
            entity.Property(e => e.Body).IsRequired();
            entity.HasIndex(e => e.Name).IsUnique();
        });

        modelBuilder.Entity<SearchHistoryEntry>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.SearchKey).IsRequired();
            entity.Property(e => e.Term).IsRequired().HasMaxLength(500).UseCollation("NOCASE");
            entity.HasIndex(e => new { e.SearchKey, e.Term }).IsUnique();
            entity.HasIndex(e => new { e.SearchKey, e.IsFavorite, e.LastSearchedAt });
        });
    }
}
