function cluster = posicionarCluster( cluster, punto )
%-----------------------------------------------------------------------------------------------------------------------
% cluster = posicionarCluster( cluster, punto )
% Coloca un clúster en el origen de coordenadas global
% 
% Argumentos de entrada:
% cluster:  Matriz con los desplazamientos X, Y, Z de los centros geométricos de los monómeros que componen el
%           clúster con respecto a su centro geométrico.
% punto:    Coordenadas del centro geométrico con respecto al centro global de coordenadas
% 
% Argumentos de salida:
% cluster:  Matriz con los desplazamientos X, Y, Z de los centros geométricos de los monómeros que componen el
%           clúster con respecto al origen de coordenadas
%
%-----------------------------------------------------------------------------------------------------------------------

punto = repmat( punto, size( cluster, 1 ), 1 );

if size( cluster, 2 ) == 4
    cluster( :, 1 : 3 ) = cluster( :, 1 : 3 ) - punto;
else
    cluster( :, 3 : 5 ) = cluster( :, 3 : 5 ) - punto;
end