# control endpoint moved

`control-endpoint` is no longer an active GlassVein endpoint.

Use `../console` (`console-endpoint`) for human session control. The console
sends canonical OSGP control/request messages with address-level `source` and
`target` and replaces the old standalone control CLI.
