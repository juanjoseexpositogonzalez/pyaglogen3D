function diam = determineMaximumDiameter( part, i, cG )

% -----------------------------------------------------------------------------------------------------------------
% diam = determineMaximumDiameter( part, i, cG )
%
% Determines the diameter of the evolving Sphere for the current
% agglomerate configuration
% 
% Input data:
% part:     Matrix with centres and radius of particles composing the
%           agglomerate.
% i:        Current iteration number (particle to be added)
% cG:       Centre of gravity of the agglomerate
%
% Output data:
% diam:     Diameter of the evolving Sphere
%
% -----------------------------------------------------------------------------------------------------------------

%% Determine the points of all particles in the clúster
%part = part{ i }( : , 3 : 6 );
if iscell( part )
    part = cell2mat( part );
    [ filas, ~ ] = unique( part( :, 1 : 2 ) );
    part = part( filas, 3 : 6  );
end

if iscell( cG )
    cG = cG{ i }{ 2 }( 2, 1 : 3 );
end

n           = 30;
[ X, Y, Z ] = sphere( n );
X           = reshape( X, size( X, 1 ) * size( X, 2 ), 1 );
Y           = reshape( Y, size( Y, 1 ) * size( Y, 2 ), 1 );
Z           = reshape( Z, size( Z, 1 ) * size( Z, 2 ), 1 );
idx         = size( X, 1 );
esferas     = zeros( idx * size( part, 1 ), 3 );

for j = 1 : size( part, 1 )
    esferas( ( 1 + ( j - 1 ) * idx ) : idx * j , : ) = ...
        [ part( j, 4 ) * X + part( j, 1 ), part( j, 4 ) * Y + part( j, 2 ), ...
        part( j, 4 ) * Z + part( j, 3 ) ];
end

%% Calculate all the distances of the point to the centre of gravity of the agglomerate
G    = repmat( cG, idx * size( part, 1 ), 1 );

%% Calculate the maximum diameter
diam = sqrt( max( sum( ( esferas - G ) .^ 2, 2 ) ) );
