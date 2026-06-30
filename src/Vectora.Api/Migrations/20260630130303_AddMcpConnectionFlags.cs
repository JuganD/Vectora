using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Vectora.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddMcpConnectionFlags : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "McpAllowSend",
                table: "Connections",
                type: "INTEGER",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "McpExposed",
                table: "Connections",
                type: "INTEGER",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "McpAllowSend",
                table: "Connections");

            migrationBuilder.DropColumn(
                name: "McpExposed",
                table: "Connections");
        }
    }
}
