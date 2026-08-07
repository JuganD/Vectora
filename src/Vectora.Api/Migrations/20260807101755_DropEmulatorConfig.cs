using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Vectora.Api.Migrations
{
    /// <inheritdoc />
    public partial class DropEmulatorConfig : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "EmulatorConfigs");

            migrationBuilder.DropColumn(
                name: "EmulatorConfigId",
                table: "Connections");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "EmulatorConfigId",
                table: "Connections",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "EmulatorConfigs",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    Content = table.Column<string>(type: "TEXT", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    FileName = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EmulatorConfigs", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_EmulatorConfigs_FileName",
                table: "EmulatorConfigs",
                column: "FileName",
                unique: true);
        }
    }
}
