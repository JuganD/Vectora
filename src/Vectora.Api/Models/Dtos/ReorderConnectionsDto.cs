namespace Vectora.Api.Models;

public class ReorderConnectionsDto
{
    // Connection ids in the desired display order (index becomes the SortOrder).
    public List<int> OrderedIds { get; set; } = new();
}
