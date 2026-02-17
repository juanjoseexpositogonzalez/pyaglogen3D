function rg = calculateRadiusOfGyration( part, i, cG )

% -----------------------------------------------------------------------------------------------------------------
% rg = calculateRadiusOfGyration( part, i, cG )
%
% Determines the radius of gyration for the agglomerate at step i
% 
% Input data:
% part:     Matrix with centres and radius of particles composing the
%           agglomerate.
% i:        Current iteration number (particle to be added)
% cG:       Centre of gravity of the agglomerate
%
% Output data:
% rg:       Radius of gyration of the agglomerate
%
% -----------------------------------------------------------------------------------------------------------------

%% Calculate radius of gyration for agglomerate
% First compute the distance to the centre of gravity of the
% agglomerate for each 

if iscell( part )
    part = part{ i }( : , 3 : 6 );  
end

if iscell( cG )
    cG = cG{ i }{ 2 } ( 2, 1 : 3 );
end

idx = size( part, 1 );
ri = sum( ( part( 1 : idx, 1 : 3 ) - repmat( cG, idx, 1 ) ).^ 2, 2 );
Ip =   sum( 3 / 5 * part( 1 : idx, 4 ) .^ 5 + part( 1 : idx, 4 ) .^ 3 .* ri );
mp = sum( part( 1 : idx, 4 ) .^ 3 );
rg = sqrt( Ip / mp );